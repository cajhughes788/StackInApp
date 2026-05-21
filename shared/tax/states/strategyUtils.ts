import { calculateStateTax, getStateCalculationMeta, normalizeStateKey } from "../state"
import type { StateCalculationResult, StateSupportLevel, StateTaxStrategy, TaxContext } from "../types"

export const ZERO_WAGE_TAX_STATES = new Set([
  "Alaska",
  "Florida",
  "Nevada",
  "NewHampshire",
  "SouthDakota",
  "Tennessee",
  "Texas",
  "Washington",
  "Wyoming",
])

export function createStateCalculationResult(
  calculationMethod: string,
  supportLevel: StateSupportLevel,
  values: Partial<Pick<StateCalculationResult, "stateTax" | "localTax" | "warnings">> = {}
): StateCalculationResult {
  return {
    stateTax: values.stateTax ?? 0,
    localTax: values.localTax ?? 0,
    supportLevel,
    calculationMethod,
    warnings: values.warnings,
  }
}

function toFallbackSupportLevel(state: string): StateSupportLevel {
  const normalizedState = normalizeStateKey(state)
  const meta = getStateCalculationMeta(normalizedState)

  if (ZERO_WAGE_TAX_STATES.has(normalizedState)) {
    return "no_wage_tax"
  }

  if (meta.status === "incomplete") {
    return "local_inputs_required"
  }

  return "approximate"
}

export const zeroWageTaxStrategy: StateTaxStrategy = {
  stateCode: "ZeroWageTax",
  applies: (context) => {
    const normalizedState = normalizeStateKey(
      context.state ?? context.workState ?? context.residenceState ?? ""
    )

    return ZERO_WAGE_TAX_STATES.has(normalizedState)
  },
  calculate: () =>
    createStateCalculationResult("No wage income tax", "no_wage_tax"),
}

export const genericFallbackStrategy: StateTaxStrategy = {
  stateCode: "GenericFallback",
  applies: () => true,
  calculate: (context: TaxContext) => {
    const state = context.state ?? "Default"
    const supportLevel = toFallbackSupportLevel(state)

    return createStateCalculationResult("Generic annualized state fallback", supportLevel, {
      stateTax: calculateStateTax(
        context.taxableIncome,
        state,
        context.payFrequency,
        context.dependents,
        context.filingStatus
      ),
    })
  },
}
