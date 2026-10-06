// /shared/entryPay.ts
// ------------------------------------------------------------
// Single read path for W-2 pay figures stored on entries.
//
// computeEntry v2 stores totals.hourlyPay (= paid hours × rate) and a
// dayTotal that already excludes unpaid break time. Entries computed under
// v1 (no totals.calcVersion) stored dayTotal = clocked hours × rate + tips
// + reportedCash, with the break subtracted later. Every consumer reads pay
// through these helpers so both generations produce identical numbers —
// before, during and after the recalculation backfill.
//
// Accepts full entries or the flattened row shapes some older pay stub
// snapshots use (dayTotal / tips / reportedCash at the top level).
// ------------------------------------------------------------
import { W2_CALC_VERSION } from "./computeEntry"

type AnyEntry = Record<string, any> | null | undefined

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function isCurrentW2Calc(entry: AnyEntry): boolean {
  return num(entry?.totals?.calcVersion) >= W2_CALC_VERSION
}

/** W-2 gross for the entry: paid hours × rate + tips + reported cash.
 * Independent (and non-W-2) entries return their stored dayTotal as-is. */
export function getEntryGross(entry: AnyEntry): number {
  const dayTotal = num(entry?.totals?.dayTotal ?? entry?.dayTotal)
  if (entry?.workspace === "independent" || isCurrentW2Calc(entry)) {
    return dayTotal
  }
  // v1: the unpaid break was inside dayTotal; take it out here.
  return Math.max(dayTotal - num(entry?.totals?.breakDeductionAmount), 0)
}

/** W-2 hourly wages only (paid hours × rate) — no tips or cash. */
export function getEntryHourlyPay(entry: AnyEntry): number {
  if (entry?.workspace === "independent") return 0
  if (isCurrentW2Calc(entry) && entry?.totals?.hourlyPay != null) {
    return num(entry.totals.hourlyPay)
  }
  const tips = num(entry?.w2?.tips ?? entry?.tips)
  const reportedCash = num(entry?.w2?.reportedCash ?? entry?.reportedCash)
  return Math.max(getEntryGross(entry) - tips - reportedCash, 0)
}
