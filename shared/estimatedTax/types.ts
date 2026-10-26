// /shared/estimatedTax/types.ts
import type { FilingStatus, TaxBracket } from "../tax/types"
import type { StateTaxRule } from "./states"

export type { FilingStatus }

type ByFilingStatus<T> = Record<FilingStatus, T>

export type EstimatedTaxYear = {
  year: number
  federal: ByFilingStatus<{ standardDeduction: number; brackets: TaxBracket[] }>
  selfEmployment: {
    netEarningsFactor: number
    socialSecurityRate: number
    medicareRate: number
    socialSecurityWageBase: number
    minimumNetEarnings: number
  }
  additionalMedicare: { rate: number; threshold: ByFilingStatus<number> }
  qbi: {
    rate: number
    threshold: ByFilingStatus<number>
    minimumDeduction: number
    minimumDeductionQbiFloor: number
  }
  childTaxCredit: {
    perChild: number
    phaseOutThreshold: ByFilingStatus<number>
    phaseOutPerThousand: number
  }
  // "No tax on tips" (§224, One Big Beautiful Bill Act), 2025–2028 only.
  // Null in years it doesn't exist.
  tipsDeduction: {
    maxDeduction: number
    // Null = this filing status can't take it (married filing separately).
    phaseOutThreshold: Record<FilingStatus, number | null>
    // $100 per $1,000 of modified AGI over the threshold.
    phaseOutRate: number
  } | null
  safeHarbor: {
    priorYearShare: number
    priorYearShareHighIncome: number
    highIncomeAgi: ByFilingStatus<number>
    currentYearShare: number
    minimumOwedForEstimates: number
  }
  // State rules for this year, by two-letter code. A state missing here
  // isn't included in the estimate (states.ts).
  states: Record<string, StateTaxRule>
  quarters: Array<{
    quarter: 1 | 2 | 3 | 4
    dueDate: string
    periodEnd: string
    annualizationFactor: number
  }>
}
