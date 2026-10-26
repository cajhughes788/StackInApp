// /shared/estimatedTax/years/2026.ts
// ------------------------------------------------------------
// Tax year 2026 figures for the self-employed estimate. Every number cites
// where it came from; update from the same sources each November (see
// years/index.ts for the yearly checklist). Brackets and standard
// deductions come from the app's existing liability table (federal2026.ts,
// Rev. Proc. 2025-32) so there is one copy of them.
// ------------------------------------------------------------
import { FEDERAL_2026 } from "../../tax/tables/federal2026"
import type { EstimatedTaxYear } from "../types"
import { STATE_TAX_2026 } from "../states"
import { FORM_1099K_THRESHOLD } from "../../taxPackage"

export const ESTIMATED_TAX_2026: EstimatedTaxYear = {
  year: 2026,

  // Rev. Proc. 2025-32 (via shared/tax/tables/federal2026.ts).
  federal: {
    single: { standardDeduction: FEDERAL_2026.single.standardDeduction, brackets: FEDERAL_2026.single.brackets },
    marriedJoint: { standardDeduction: FEDERAL_2026.marriedJoint.standardDeduction, brackets: FEDERAL_2026.marriedJoint.brackets },
    marriedSeparate: { standardDeduction: FEDERAL_2026.marriedSeparate.standardDeduction, brackets: FEDERAL_2026.marriedSeparate.brackets },
    headOfHousehold: { standardDeduction: FEDERAL_2026.headOfHousehold.standardDeduction, brackets: FEDERAL_2026.headOfHousehold.brackets },
  },

  // Schedule SE. Rates and the 92.35% factor are in the Internal Revenue
  // Code (§1401, §1402(a)(12)); the wage base is the SSA's 2026
  // contribution and benefit base ($184,500, announced Oct 2025).
  selfEmployment: {
    netEarningsFactor: 0.9235,
    socialSecurityRate: 0.124,
    medicareRate: 0.029,
    socialSecurityWageBase: 184_500,
    // No SE tax when net earnings (after the factor) are under $400.
    minimumNetEarnings: 400,
  },

  // Form 8959. Thresholds are set in the Code (§3101(b)(2)) and are not
  // indexed for inflation.
  additionalMedicare: {
    rate: 0.009,
    threshold: { single: 200_000, headOfHousehold: 200_000, marriedJoint: 250_000, marriedSeparate: 125_000 },
  },

  // Section 199A (QBI). Thresholds: Rev. Proc. 2025-32. Above the
  // threshold the deduction depends on W-2 wages paid, property and the
  // kind of business — not supported (see calculate.ts). The $400 minimum
  // is §199A(i), added by the One Big Beautiful Bill Act from 2026.
  qbi: {
    rate: 0.2,
    threshold: { single: 201_750, headOfHousehold: 201_750, marriedJoint: 403_500, marriedSeparate: 201_775 },
    minimumDeduction: 400,
    minimumDeductionQbiFloor: 1_000,
  },

  // Child tax credit: $2,200 per qualifying child (One Big Beautiful Bill
  // Act), reduced $50 per $1,000 of modified AGI over the threshold. Only
  // the nonrefundable part (against income tax) is used — a conservative
  // simplification; the refundable $1,700 part is ignored.
  childTaxCredit: {
    perChild: 2_200,
    phaseOutThreshold: { single: 200_000, headOfHousehold: 200_000, marriedSeparate: 200_000, marriedJoint: 400_000 },
    phaseOutPerThousand: 50,
  },

  // "No tax on tips" (§224, added by the One Big Beautiful Bill Act for
  // 2025–2028): up to $25,000 of qualified tips, reduced $100 per $1,000 of
  // modified AGI over $150,000 ($300,000 joint); married filing separately
  // can't take it. Income tax only — SE tax is still owed on tips.
  // Occupations: Treasury final rule, Apr 2026 (tippedOccupations.ts).
  tipsDeduction: {
    maxDeduction: 25_000,
    phaseOutThreshold: { single: 150_000, headOfHousehold: 150_000, marriedJoint: 300_000, marriedSeparate: null },
    phaseOutRate: 0.1,
  },

  // Form 1040-ES (2026): penalty-free if payments reach 100% of last year's
  // tax, or 110% when last year's AGI was over $150,000 ($75,000 married
  // filing separately); or 90% of this year's tax. No estimated payments
  // are required when less than $1,000 is owed after withholding.
  safeHarbor: {
    priorYearShare: 1.0,
    priorYearShareHighIncome: 1.1,
    highIncomeAgi: { single: 150_000, headOfHousehold: 150_000, marriedJoint: 150_000, marriedSeparate: 75_000 },
    currentYearShare: 0.9,
    minimumOwedForEstimates: 1_000,
  },

  form1099K: FORM_1099K_THRESHOLD,

  // State income tax: only states confirmed from their own revenue
  // department for 2026 (sources in states.ts).
  states: STATE_TAX_2026,

  // Form 1040-ES (2026) due dates, and the Form 2210 Schedule AI periods
  // (income through each period end, annualized by the factor).
  quarters: [
    { quarter: 1, dueDate: "2026-04-15", periodEnd: "2026-03-31", annualizationFactor: 4 },
    { quarter: 2, dueDate: "2026-06-15", periodEnd: "2026-05-31", annualizationFactor: 2.4 },
    { quarter: 3, dueDate: "2026-09-15", periodEnd: "2026-08-31", annualizationFactor: 1.5 },
    { quarter: 4, dueDate: "2027-01-15", periodEnd: "2026-12-31", annualizationFactor: 1 },
  ],
}
