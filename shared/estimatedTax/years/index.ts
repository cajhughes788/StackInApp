// /shared/estimatedTax/years/index.ts
// ------------------------------------------------------------
// The tax years the estimate supports. There is NO fallback: a year
// without its own table gets no estimate (getEstimatedTaxYear → null) and
// the app says so, rather than quietly reusing last year's numbers.
//
// Yearly update checklist (each November, when the IRS publishes the
// inflation adjustments — usually a Rev. Proc. in October/November):
//   1. Brackets + standard deductions → shared/tax/tables/federal<year>.ts
//   2. SSA contribution and benefit base (Social Security wage base)
//   3. QBI threshold amounts (§199A)
//   4. Child tax credit amount and any law changes
//   5. Form 1040-ES due dates (weekend / holiday shifts)
//   6. Any new deductions or credits (e.g. the tips deduction ends after 2028)
// Copy years/<last>.ts to years/<year>.ts, update every cited number, add
// it below, and add a worked household for the new year to
// scripts/test-estimated-tax.cjs. The tests fail if the current year is
// missing (see missingTaxYearMessage).
// ------------------------------------------------------------
import type { EstimatedTaxYear } from "../types"
import { ESTIMATED_TAX_2026 } from "./2026"

const YEARS: Record<number, EstimatedTaxYear> = {
  2026: ESTIMATED_TAX_2026,
}

export const SUPPORTED_ESTIMATED_TAX_YEARS = Object.keys(YEARS).map(Number).sort((a, b) => a - b)

export function getEstimatedTaxYear(year: number): EstimatedTaxYear | null {
  return YEARS[year] ?? null
}

/** Null when the year is supported; otherwise what the app should show. */
export function missingTaxYearMessage(year: number): string | null {
  if (YEARS[year]) return null
  return `Tax estimates for ${year} aren't available yet. We update them once the IRS publishes ${year}'s numbers.`
}
