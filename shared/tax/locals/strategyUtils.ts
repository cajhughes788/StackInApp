import { normalizeStateKey } from "../state"
import type { LocalCalculationResult, LocalTaxStrategy, TaxContext } from "../types"

export function createLocalCalculationResult(
  calculationMethod: string,
  values: Partial<Pick<LocalCalculationResult, "localTax" | "warnings">> = {}
): LocalCalculationResult {
  return {
    localTax: values.localTax ?? 0,
    calculationMethod,
    warnings: values.warnings,
  }
}

export function isMatchingLocalStateContext(
  context: Pick<TaxContext, "state" | "residenceState" | "workState">,
  stateCode: string
): boolean {
  const normalizedStateCode = normalizeStateKey(stateCode)

  return [context.state, context.residenceState, context.workState]
    .map((value) => normalizeStateKey(value ?? ""))
    .some((value) => value === normalizedStateCode)
}

export function createNoopLocalStrategy(
  jurisdictionCode: string,
  warning: string
): LocalTaxStrategy {
  return {
    jurisdictionCode,
    applies: (context) => isMatchingLocalStateContext(context, jurisdictionCode),
    calculate: () =>
      createLocalCalculationResult(`${jurisdictionCode} local withholding not yet implemented`, {
        warnings: [warning],
      }),
  }
}
