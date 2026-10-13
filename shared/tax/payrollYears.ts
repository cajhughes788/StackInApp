// /shared/tax/payrollYears.ts

import { PAYROLL_2026 } from "./tables/payroll2026"
import type { PayrollYearParams } from "./types"

// Federal payroll tables by tax year. Add next year's file here once the IRS
// publishes Publication 15-T (usually December) and SSA announces the wage
// base (usually October).
const PAYROLL_YEARS: Record<number, PayrollYearParams> = {
  2026: PAYROLL_2026,
}

const AVAILABLE_YEARS = Object.keys(PAYROLL_YEARS).map(Number).sort((a, b) => a - b)

// The tables for the paycheck's year. A year without tables falls back to
// the nearest earlier year (or the earliest, for older paychecks) and says so.
export function resolvePayrollYear(
  payDate?: string | null,
  now: Date = new Date()
): { params: PayrollYearParams; requested: number; used: number; isFallback: boolean } {
  const fromDate = payDate ? Number(payDate.slice(0, 4)) : NaN
  const requested = Number.isFinite(fromDate) && fromDate > 1900 ? fromDate : now.getFullYear()
  const used =
    PAYROLL_YEARS[requested] != null
      ? requested
      : [...AVAILABLE_YEARS].reverse().find((year) => year <= requested) ?? AVAILABLE_YEARS[0]
  return { params: PAYROLL_YEARS[used], requested, used, isFallback: used !== requested }
}
