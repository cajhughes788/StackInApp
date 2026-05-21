import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type DCPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

const DC_ALLOWANCE_VALUE = 1_775

function getPeriodsPerYear(freq: DCPayrollFrequency): number {
  switch (freq) {
    case "weekly":
      return 52
    case "biweekly":
      return 26
    case "semi-monthly":
      return 24
    case "monthly":
      return 12
    case "annual":
      return 1
  }
}

function calculateDCAnnualTax(annualTaxableWages: number): number {
  if (annualTaxableWages <= 10_000) {
    return annualTaxableWages * 0.04
  }

  if (annualTaxableWages <= 40_000) {
    return 400 + (annualTaxableWages - 10_000) * 0.06
  }

  if (annualTaxableWages <= 60_000) {
    return 2_200 + (annualTaxableWages - 40_000) * 0.065
  }

  if (annualTaxableWages <= 250_000) {
    return 3_500 + (annualTaxableWages - 60_000) * 0.085
  }

  if (annualTaxableWages <= 500_000) {
    return 19_650 + (annualTaxableWages - 250_000) * 0.0925
  }

  if (annualTaxableWages <= 1_000_000) {
    return 42_775 + (annualTaxableWages - 500_000) * 0.0975
  }

  return 91_525 + (annualTaxableWages - 1_000_000) * 0.1075
}

export function isDistrictOfColumbiaWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    primaryState === "WashingtonDC" ||
    residenceState === "WashingtonDC" ||
    workState === "WashingtonDC"
  )
}

export function calculateDistrictOfColumbiaWithholding(profile: {
  taxableIncome: number
  filingStatus: FilingStatus
  payFrequency: DCPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  districtOfColumbiaWithholdingExemptions?: number
  stateWithholdingExemptions?: number
  districtOfColumbiaExempt?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isResident = residenceState === "WashingtonDC"

  if (!isResident && primaryState !== "WashingtonDC") {
    return 0
  }

  if (!isResident && workState === "WashingtonDC") {
    return 0
  }

  if (profile.districtOfColumbiaExempt) {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualTaxableWages = clampNonNegative(
    d(profile.taxableIncome)
      .mul(periods)
      .sub(
        d(
          profile.districtOfColumbiaWithholdingExemptions ??
            profile.stateWithholdingExemptions ??
            0
        ).mul(DC_ALLOWANCE_VALUE)
      )
  ).toNumber()
  const annualTax = calculateDCAnnualTax(annualTaxableWages)

  return d(annualTax).div(periods).toDecimalPlaces(2).toNumber()
}

export const washingtonDCStrategy: StateTaxStrategy = {
  stateCode: "WashingtonDC",
  applies: (context) => isDistrictOfColumbiaWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (residenceState !== "WashingtonDC" && workState === "WashingtonDC") {
      warnings.push(
        "The District generally does not tax nonresident wage income, so this calculator treats nonresident District work wages as not subject to DC withholding."
      )
    }

    if (residenceState === "WashingtonDC" && workState !== "WashingtonDC") {
      warnings.push(
        "District resident employees working outside DC can still owe DC tax after credits for other-state withholding, but that resident credit coordination is not fully modeled here."
      )
    }

    if (context.filingStatus === "headOfHousehold" || context.filingStatus === "marriedJoint") {
      warnings.push(
        "District withholding is using the D-4 allowance count with current DC resident brackets, but the latest official FR-230 payroll table was not directly retrievable during implementation, so this remains a dedicated payroll-style approximation."
      )
    }

    return createStateCalculationResult("District of Columbia D-4 allowance payroll method", "dedicated", {
      stateTax: calculateDistrictOfColumbiaWithholding({
        taxableIncome: context.taxableIncome,
        filingStatus: context.filingStatus,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        districtOfColumbiaWithholdingExemptions:
          context.profile.districtOfColumbiaWithholdingExemptions,
        stateWithholdingExemptions: context.profile.stateWithholdingExemptions,
        districtOfColumbiaExempt: context.profile.districtOfColumbiaExempt,
      }),
      warnings,
    })
  },
}
