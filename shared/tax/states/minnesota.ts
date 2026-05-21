import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type MinnesotaPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

const MINNESOTA_RECIPROCITY_STATES = new Set(["Michigan", "NorthDakota"])

function getPeriodsPerYear(freq: MinnesotaPayrollFrequency): number {
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

function useMinnesotaMarriedStatus(filingStatus: FilingStatus): boolean {
  return filingStatus === "marriedJoint" || filingStatus === "marriedSeparate"
}

function calculateMinnesotaAnnualTax(annualTaxableWages: number, married: boolean): number {
  if (married) {
    if (annualTaxableWages <= 14_700) return 0
    if (annualTaxableWages <= 63_400) return (annualTaxableWages - 14_700) * 0.0535
    if (annualTaxableWages <= 208_180) return 2_605.45 + (annualTaxableWages - 63_400) * 0.068
    if (annualTaxableWages <= 352_630) return 12_450.49 + (annualTaxableWages - 208_180) * 0.0785

    return 23_789.82 + (annualTaxableWages - 352_630) * 0.0985
  }

  if (annualTaxableWages <= 4_700) return 0
  if (annualTaxableWages <= 38_010) return (annualTaxableWages - 4_700) * 0.0535
  if (annualTaxableWages <= 114_130) return 1_782.09 + (annualTaxableWages - 38_010) * 0.068
  if (annualTaxableWages <= 207_850) return 6_958.25 + (annualTaxableWages - 114_130) * 0.0785

  return 14_315.27 + (annualTaxableWages - 207_850) * 0.0985
}

export function isMinnesotaWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return primaryState === "Minnesota" || residenceState === "Minnesota" || workState === "Minnesota"
}

export function calculateMinnesotaWithholding(profile: {
  taxableIncome: number
  filingStatus: FilingStatus
  payFrequency: MinnesotaPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  reciprocityElection?: boolean
  minnesotaWithholdingExemptions?: number
  stateWithholdingExemptions?: number
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isResident = residenceState === "Minnesota"
  const worksInState = workState === "Minnesota"

  if (!isResident && !worksInState && primaryState !== "Minnesota") {
    return 0
  }

  if (
    !isResident &&
    worksInState &&
    profile.reciprocityElection &&
    MINNESOTA_RECIPROCITY_STATES.has(residenceState)
  ) {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualWages = d(profile.taxableIncome).mul(periods).toNumber()
  const annualTaxableWages = clampNonNegative(
    d(annualWages).sub(
      d(profile.minnesotaWithholdingExemptions ?? profile.stateWithholdingExemptions ?? 0).mul(
        5_300
      )
    )
  ).toNumber()
  const annualTax = calculateMinnesotaAnnualTax(
    annualTaxableWages,
    useMinnesotaMarriedStatus(profile.filingStatus)
  )

  return d(annualTax).div(periods).toDecimalPlaces(2).toNumber()
}

export const minnesotaStrategy: StateTaxStrategy = {
  stateCode: "Minnesota",
  applies: (context) => isMinnesotaWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (
      residenceState !== "Minnesota" &&
      workState === "Minnesota" &&
      MINNESOTA_RECIPROCITY_STATES.has(residenceState) &&
      !context.reciprocityElection
    ) {
      warnings.push(
        "Minnesota reciprocity for Michigan and North Dakota residents is only applied here when the reciprocity election is turned on."
      )
    }

    if (residenceState !== "Minnesota" && workState === "Minnesota") {
      warnings.push(
        "Minnesota nonresident withholding may be waived when expected annual Minnesota wages stay below the state's minimum filing threshold, which this calculator does not track yet."
      )
    }

    return createStateCalculationResult("Minnesota 2026 computer-formula withholding", "dedicated", {
      stateTax: calculateMinnesotaWithholding({
        taxableIncome: context.taxableIncome,
        filingStatus: context.filingStatus,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        reciprocityElection: context.reciprocityElection,
        minnesotaWithholdingExemptions: context.profile.minnesotaWithholdingExemptions,
        stateWithholdingExemptions: context.profile.stateWithholdingExemptions,
      }),
      warnings,
    })
  },
}
