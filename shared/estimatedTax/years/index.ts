// /shared/estimatedTax/years/index.ts
// ------------------------------------------------------------
// The tax years the estimate supports. There is NO fallback: a year
// without its own table gets no estimate (getEstimatedTaxYear → null) and
// the app says so, rather than quietly reusing last year's numbers.
//
// Adding a year (each November): follow docs/tax-yearly-update.md. Start
// with `node scripts/new-tax-year.cjs <year>`, which drafts the table with
// every number marked unverified; add the year below only once each one is
// checked. The tests warn from Nov 1 and fail from Jan 1 if the year is
// missing; the app switches to it on Jan 16.
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
