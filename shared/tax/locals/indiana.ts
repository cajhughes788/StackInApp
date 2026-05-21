import { d } from "../math"
import { normalizeStateKey } from "../state"
import { getIndianaTaxableWages } from "../states/indiana"
import { getIndianaCountyTaxRate } from "../tables/indianaCountyRates2026"
import { createLocalCalculationResult } from "./strategyUtils"
import type { LocalTaxStrategy, TaxContext } from "../types"

function getIndianaCountyContext(context: TaxContext): {
  primaryState: string
  residenceState: string
  workState: string
  applicableCounty: string | undefined
} {
  const primaryState = normalizeStateKey(context.state ?? "")
  const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
  const workState = normalizeStateKey(context.workState ?? context.state ?? "")
  const residentInIndiana = residenceState === "Indiana"

  return {
    primaryState,
    residenceState,
    workState,
    applicableCounty: residentInIndiana
      ? context.residenceCounty
      : workState === "Indiana"
        ? context.workCounty
        : undefined,
  }
}

function isIndianaCountyWithholdingExempt(context: TaxContext): boolean {
  const { residenceState, workState } = getIndianaCountyContext(context)

  return (
    residenceState !== "Indiana" &&
    workState === "Indiana" &&
    Boolean(
      context.profile.indianaNonresidentThirtyDayExempt ||
      context.profile.indianaNonresidentMilitarySpouseExempt
    )
  )
}

export function calculateIndianaLocalTax(context: TaxContext): number {
  const { primaryState, residenceState, workState, applicableCounty } =
    getIndianaCountyContext(context)

  if (
    primaryState !== "Indiana" &&
    residenceState !== "Indiana" &&
    workState !== "Indiana"
  ) {
    return 0
  }

  if (isIndianaCountyWithholdingExempt(context)) {
    return 0
  }

  const taxableWages = getIndianaTaxableWages({
    taxableIncome: context.taxableIncome,
    payFrequency: context.payFrequency,
    indianaPersonalExemptions: context.profile.indianaPersonalExemptions,
    indianaDependentExemptions: context.profile.indianaDependentExemptions,
    indianaFirstTimeDependentExemptions: context.profile.indianaFirstTimeDependentExemptions,
    indianaAdoptedChildExemptions: context.profile.indianaAdoptedChildExemptions,
  })
  const rate = getIndianaCountyTaxRate(applicableCounty)
  if (rate == null) {
    return d(context.profile.indianaAdditionalCountyWithholding ?? 0)
      .toDecimalPlaces(2)
      .toNumber()
  }

  return d(taxableWages)
    .mul(rate)
    .add(context.profile.indianaAdditionalCountyWithholding ?? 0)
    .toDecimalPlaces(2)
    .toNumber()
}

export const indianaLocalStrategy: LocalTaxStrategy = {
  jurisdictionCode: "Indiana",
  applies: (context) => {
    const { primaryState, residenceState, workState } = getIndianaCountyContext(context)
    return (
      primaryState === "Indiana" ||
      residenceState === "Indiana" ||
      workState === "Indiana"
    )
  },
  calculate: (context) => {
    const { residenceState, workState, applicableCounty } =
      getIndianaCountyContext(context)
    const residentInIndiana = residenceState === "Indiana"
    const exemptFromIndianaCountyWithholding = isIndianaCountyWithholdingExempt(context)
    const warnings: string[] = []

    if (exemptFromIndianaCountyWithholding) {
      warnings.push(
        "Indiana county withholding is treated as exempt here only when a qualifying WH-4AFF or WH-4MIL exemption applies."
      )
    }

    if (residentInIndiana && !applicableCounty) {
      warnings.push(
        "Indiana county withholding uses the employee's Indiana county of residence as of January 1, and that county is missing."
      )
    } else if (!residentInIndiana && workState === "Indiana" && !applicableCounty) {
      warnings.push(
        "Indiana nonresident county withholding uses the Indiana principal work county as of January 1, and that county is missing."
      )
    } else if (applicableCounty && getIndianaCountyTaxRate(applicableCounty) == null) {
      warnings.push(
        "Indiana county withholding could not match the provided county name to a 2026 county tax rate."
      )
    }

    if (residentInIndiana) {
      warnings.push(
        "Indiana county tax is based on the county of residence on January 1 and does not change during the year if the employee moves."
      )
    } else if (workState === "Indiana") {
      warnings.push(
        "Indiana nonresident county tax is based on the principal Indiana work county on January 1."
      )
    }

    return createLocalCalculationResult("Indiana county payroll withholding", {
      localTax: calculateIndianaLocalTax(context),
      warnings,
    })
  },
}
