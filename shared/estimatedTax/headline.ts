// /shared/estimatedTax/headline.ts
// ------------------------------------------------------------
// What the Taxes card leads with, and so the amount the reminder push
// names — one rule for both (tax-estimate-card.tsx, sendTaxRemindersDaily).
//
//   not_needed   — this year's estimate can be trusted and is under the
//                  $1,000 the IRS requires estimates for: nothing to pay,
//                  whatever last year's tax was
//   penalty_free — last year's tax sets a penalty-free amount (0 = nothing
//                  due); a rule, so it leads when known
//   set_aside    — this year's estimate (0 = payments already cover it)
//   null         — nothing safe to show yet
// ------------------------------------------------------------
import type { DataHealthResult } from "./dataHealth"
import type { QuarterlyResult } from "./quarterly"

export type TaxHeadline =
  | { kind: "not_needed" }
  | { kind: "penalty_free"; amount: number }
  | { kind: "set_aside"; amount: number }
  | null

export function taxHeadline(
  health: Pick<DataHealthResult, "canShowEstimate" | "canShowSafeHarbor">,
  quarterly: Pick<QuarterlyResult, "belowEstimatesThreshold" | "penaltyFree" | "basedOnEarnings"> | null
): TaxHeadline {
  if (!quarterly) return null
  // Under $1,000 owed is only believed when the estimate itself is shown;
  // with shaky records, last year's amount stays the safe answer.
  if (health.canShowEstimate && quarterly.belowEstimatesThreshold) return { kind: "not_needed" }
  if (health.canShowSafeHarbor && quarterly.penaltyFree != null) return { kind: "penalty_free", amount: quarterly.penaltyFree }
  if (health.canShowEstimate) return { kind: "set_aside", amount: quarterly.basedOnEarnings }
  return null
}

/** The amount a reminder names (0 = don't send one). */
export function headlineAmount(headline: TaxHeadline): number {
  return headline && headline.kind !== "not_needed" ? headline.amount : 0
}
