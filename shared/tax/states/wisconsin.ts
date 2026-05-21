import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type WisconsinPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

const WISCONSIN_RECIPROCITY_STATES = new Set([
  "Illinois",
  "Indiana",
  "Kentucky",
  "Michigan",
])

function getPeriodsPerYear(freq: WisconsinPayrollFrequency): number {
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

function useWisconsinMarriedStatus(filingStatus: FilingStatus): boolean {
  return filingStatus === "marriedJoint" || filingStatus === "marriedSeparate"
}

function getWisconsinDeductionAmount(annualGrossEarnings: number, married: boolean): number {
  if (married) {
    if (annualGrossEarnings < 25_727) return 9_461
    if (annualGrossEarnings >= 73_032) return 0

    return 9_461 - 0.2 * (annualGrossEarnings - 25_727)
  }

  if (annualGrossEarnings < 17_780) return 6_702
  if (annualGrossEarnings >= 73_630) return 0

  return 6_702 - 0.12 * (annualGrossEarnings - 17_780)
}

function calculateWisconsinAnnualTax(annualNetWage: number): number {
  if (annualNetWage <= 12_760) {
    return annualNetWage * 0.0354
  }

  if (annualNetWage <= 25_520) {
    return 451.7 + (annualNetWage - 12_760) * 0.0465
  }

  if (annualNetWage <= 280_950) {
    return 1_045.04 + (annualNetWage - 25_520) * 0.053
  }

  return 14_582.83 + (annualNetWage - 280_950) * 0.0765
}

export function isWisconsinWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    primaryState === "Wisconsin" ||
    residenceState === "Wisconsin" ||
    workState === "Wisconsin"
  )
}

export function calculateWisconsinWithholding(profile: {
  taxableIncome: number
  filingStatus: FilingStatus
  payFrequency: WisconsinPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  reciprocityElection?: boolean
  wisconsinWithholdingExemptions?: number
  stateWithholdingExemptions?: number
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isResident = residenceState === "Wisconsin"
  const worksInState = workState === "Wisconsin"

  if (!isResident && !worksInState && primaryState !== "Wisconsin") {
    return 0
  }

  if (
    !isResident &&
    worksInState &&
    profile.reciprocityElection &&
    WISCONSIN_RECIPROCITY_STATES.has(residenceState)
  ) {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualGrossEarnings = d(profile.taxableIncome).mul(periods).toNumber()
  const deductionAmount = getWisconsinDeductionAmount(
    annualGrossEarnings,
    useWisconsinMarriedStatus(profile.filingStatus)
  )
  const annualNetWage = clampNonNegative(
    d(annualGrossEarnings)
      .sub(deductionAmount)
      .sub(
        d(
          profile.wisconsinWithholdingExemptions ?? profile.stateWithholdingExemptions ?? 0
        ).mul(400)
      )
  ).toNumber()
  const annualTax = calculateWisconsinAnnualTax(annualNetWage)

  return d(annualTax).div(periods).toDecimalPlaces(2).toNumber()
}

export const wisconsinStrategy: StateTaxStrategy = {
  stateCode: "Wisconsin",
  applies: (context) => isWisconsinWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (
      residenceState !== "Wisconsin" &&
      workState === "Wisconsin" &&
      WISCONSIN_RECIPROCITY_STATES.has(residenceState) &&
      !context.reciprocityElection
    ) {
      warnings.push(
        "Wisconsin reciprocity for Illinois, Indiana, Kentucky, and Michigan residents is only applied here when the reciprocity election is turned on."
      )
    }

    if (residenceState === "Wisconsin" && workState !== "Wisconsin") {
      warnings.push(
        "Wisconsin residents working in another state can still owe Wisconsin withholding after credits for tax paid to that other state, but payroll coordination with the work-state employer is not fully modeled here."
      )
    }

    return createStateCalculationResult("Wisconsin W-166 alternate payroll withholding method", "dedicated", {
      stateTax: calculateWisconsinWithholding({
        taxableIncome: context.taxableIncome,
        filingStatus: context.filingStatus,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        reciprocityElection: context.reciprocityElection,
        wisconsinWithholdingExemptions: context.profile.wisconsinWithholdingExemptions,
        stateWithholdingExemptions: context.profile.stateWithholdingExemptions,
      }),
      warnings,
    })
  },
}
