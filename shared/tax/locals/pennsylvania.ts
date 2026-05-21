import { d } from "../math"
import { normalizeStateKey } from "../state"
import { createLocalCalculationResult } from "./strategyUtils"
import type { LocalTaxStrategy, TaxContext } from "../types"

function toRateDecimal(value?: number): number {
  return value != null ? value / 100 : 0
}

function getPennsylvaniaStateContext(context: TaxContext): {
  residenceState: string
  workState: string
  primaryState: string
} {
  return {
    primaryState: normalizeStateKey(context.state ?? ""),
    residenceState: normalizeStateKey(context.residenceState ?? context.state ?? ""),
    workState: normalizeStateKey(context.workState ?? context.state ?? ""),
  }
}

export function calculatePennsylvaniaLocalTax(context: TaxContext): number {
  const { residenceState, workState, primaryState } = getPennsylvaniaStateContext(context)
  const worksInPennsylvania = workState === "Pennsylvania"
  const residentInPennsylvania = residenceState === "Pennsylvania"

  if (!worksInPennsylvania && !residentInPennsylvania && primaryState !== "Pennsylvania") {
    return 0
  }

  if (!worksInPennsylvania) {
    return 0
  }

  const residentRate = residentInPennsylvania
    ? toRateDecimal(context.pennsylvaniaResidentEitRate)
    : 0
  const workNonResidentRate = toRateDecimal(
    context.pennsylvaniaWorkNonResidentEitRate
  )
  const withholdingRate = Math.max(residentRate, workNonResidentRate)

  return d(context.taxableIncome)
    .mul(withholdingRate)
    .toDecimalPlaces(2)
    .toNumber()
}

export const pennsylvaniaLocalStrategy: LocalTaxStrategy = {
  jurisdictionCode: "Pennsylvania",
  applies: (context) => {
    const { residenceState, workState, primaryState } = getPennsylvaniaStateContext(context)

    return (
      primaryState === "Pennsylvania" ||
      residenceState === "Pennsylvania" ||
      workState === "Pennsylvania"
    )
  },
  calculate: (context) => {
    const { residenceState, workState } = getPennsylvaniaStateContext(context)
    const worksInPennsylvania = workState === "Pennsylvania"
    const residentInPennsylvania = residenceState === "Pennsylvania"
    const residentRate = context.pennsylvaniaResidentEitRate
    const workRate = context.pennsylvaniaWorkNonResidentEitRate
    const warnings: string[] = []

    if (worksInPennsylvania && residentInPennsylvania && residentRate == null && workRate == null) {
      warnings.push(
        "Pennsylvania local withholding needs either the resident EIT rate, the work nonresident EIT rate, or both."
      )
    } else if (worksInPennsylvania && residentInPennsylvania && residentRate == null) {
      warnings.push(
        "Pennsylvania resident withholding is using only the work-location nonresident EIT rate because the resident EIT rate is missing."
      )
    } else if (worksInPennsylvania && workRate == null) {
      warnings.push(
        "Pennsylvania withholding is using only the resident EIT rate because the work-location nonresident EIT rate is missing."
      )
    } else if (residentInPennsylvania && !worksInPennsylvania) {
      warnings.push(
        "Pennsylvania resident employees working outside Pennsylvania may still owe resident EIT, but employer withholding depends on the employer and work arrangement."
      )
    }

    return createLocalCalculationResult("Pennsylvania local EIT withholding", {
      localTax: calculatePennsylvaniaLocalTax(context),
      warnings,
    })
  },
}
