import { d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type NorthDakotaPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

const NORTH_DAKOTA_RECIPROCITY_STATES = new Set(["Minnesota", "Montana"])

function getPeriodsPerYear(freq: NorthDakotaPayrollFrequency): number {
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

function calculateNorthDakotaAnnualTax(
  annualTaxableWages: number,
  filingStatus: FilingStatus
): number {
  if (filingStatus === "marriedJoint") {
    if (annualTaxableWages <= 57_500) return 0
    if (annualTaxableWages <= 168_525) return (annualTaxableWages - 57_500) * 0.0195

    return 2_164.99 + (annualTaxableWages - 168_525) * 0.025
  }

  if (filingStatus === "headOfHousehold") {
    if (annualTaxableWages <= 78_475) return 0
    if (annualTaxableWages <= 289_675) return (annualTaxableWages - 78_475) * 0.0195

    return 4_118.4 + (annualTaxableWages - 289_675) * 0.025
  }

  if (annualTaxableWages <= 57_625) return 0
  if (annualTaxableWages <= 258_450) return (annualTaxableWages - 57_625) * 0.0195

  return 3_916.09 + (annualTaxableWages - 258_450) * 0.025
}

export function isNorthDakotaWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    primaryState === "NorthDakota" ||
    residenceState === "NorthDakota" ||
    workState === "NorthDakota"
  )
}

export function calculateNorthDakotaWithholding(profile: {
  taxableIncome: number
  filingStatus: FilingStatus
  payFrequency: NorthDakotaPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  reciprocityElection?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isResident = residenceState === "NorthDakota"
  const worksInState = workState === "NorthDakota"

  if (!isResident && !worksInState && primaryState !== "NorthDakota") {
    return 0
  }

  if (
    !isResident &&
    worksInState &&
    profile.reciprocityElection &&
    NORTH_DAKOTA_RECIPROCITY_STATES.has(residenceState)
  ) {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualTax = calculateNorthDakotaAnnualTax(
    d(profile.taxableIncome).mul(periods).toNumber(),
    profile.filingStatus
  )

  return Math.round(annualTax / periods)
}

export const northDakotaStrategy: StateTaxStrategy = {
  stateCode: "NorthDakota",
  applies: (context) => isNorthDakotaWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (
      residenceState !== "NorthDakota" &&
      workState === "NorthDakota" &&
      NORTH_DAKOTA_RECIPROCITY_STATES.has(residenceState) &&
      !context.reciprocityElection
    ) {
      warnings.push(
        "North Dakota reciprocity for Minnesota and Montana residents is only applied here when the reciprocity toggle is turned on."
      )
    }

    if (residenceState === "NorthDakota" && workState !== "NorthDakota") {
      warnings.push(
        "North Dakota resident employees working in another state may still need North Dakota withholding if the employer is not withholding the other state's tax, which this calculator does not determine automatically."
      )
    }

    return createStateCalculationResult("North Dakota 2026 annual percentage method", "dedicated", {
      stateTax: calculateNorthDakotaWithholding({
        taxableIncome: context.taxableIncome,
        filingStatus: context.filingStatus,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        reciprocityElection: context.reciprocityElection,
      }),
      warnings,
    })
  },
}
