import { calculateMarylandWithholding, isMarylandWithholdingState } from "../states/maryland"
import { createLocalCalculationResult } from "./strategyUtils"
import type { LocalTaxStrategy, TaxContext } from "../types"

export function calculateMarylandLocalTax(context: TaxContext): number {
  return calculateMarylandWithholding({
    taxableIncome: context.taxableIncome,
    filingStatus: context.filingStatus,
    dependents: context.dependents,
    marylandWithholdingExemptions: context.profile.marylandWithholdingExemptions,
    stateWithholdingExemptions: context.profile.stateWithholdingExemptions,
    payFrequency: context.payFrequency,
    state: context.state,
    residenceState: context.residenceState,
    workState: context.workState,
    residenceCounty: context.residenceCounty,
    workCounty: context.workCounty,
    reciprocityElection: context.reciprocityElection,
  }).local
}

export const marylandLocalStrategy: LocalTaxStrategy = {
  jurisdictionCode: "Maryland",
  applies: (context) => isMarylandWithholdingState(context),
  calculate: (context) =>
    createLocalCalculationResult("Maryland local payroll withholding", {
      localTax: calculateMarylandLocalTax(context),
    }),
}
