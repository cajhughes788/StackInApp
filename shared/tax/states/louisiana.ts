import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { ZERO_WAGE_TAX_STATES, createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type LouisianaPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

type LouisianaDeductionClaim = NonNullable<TaxProfileInput["louisianaDeductionClaim"]>

const LOUISIANA_WITHHOLDING_RATE = 0.0309

function getPeriodsPerYear(freq: LouisianaPayrollFrequency): number {
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

function getDefaultLouisianaDeductionClaim(filingStatus: FilingStatus): LouisianaDeductionClaim {
  switch (filingStatus) {
    case "single":
    case "marriedSeparate":
      return "1"
    case "marriedJoint":
    case "headOfHousehold":
      return "2"
  }
}

function getLouisianaAnnualDeduction(claim: LouisianaDeductionClaim): number {
  switch (claim) {
    case "0":
      return 0
    case "1":
      return 12_500
    case "2":
      return 25_000
  }
}

export function isLouisianaWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  if (primaryState) {
    return primaryState === "Louisiana"
  }

  return residenceState === "Louisiana" || workState === "Louisiana"
}

export function calculateLouisianaWithholding(profile: {
  taxableIncome: number
  payFrequency: LouisianaPayrollFrequency
  filingStatus: FilingStatus
  state?: string
  residenceState?: string
  workState?: string
  louisianaDeductionClaim?: LouisianaDeductionClaim
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")

  if (primaryState !== "Louisiana" && residenceState !== "Louisiana" && workState !== "Louisiana") {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualGrossIncome = d(profile.taxableIncome).mul(periods)
  const deductionClaim =
    profile.louisianaDeductionClaim ?? getDefaultLouisianaDeductionClaim(profile.filingStatus)
  const annualTaxableIncome = clampNonNegative(
    annualGrossIncome.sub(getLouisianaAnnualDeduction(deductionClaim))
  )

  return annualTaxableIncome
    .mul(LOUISIANA_WITHHOLDING_RATE)
    .div(periods)
    .toDecimalPlaces(2)
    .toNumber()
}

export const louisianaStrategy: StateTaxStrategy = {
  stateCode: "Louisiana",
  applies: (context) => isLouisianaWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (
      residenceState === "Louisiana" &&
      workState &&
      workState !== "Louisiana" &&
      !ZERO_WAGE_TAX_STATES.has(workState)
    ) {
      warnings.push(
        "Louisiana residents working in another income-tax state may not need separate Louisiana withholding when wages are already subject to withholding in the work state."
      )
    }

    if (
      residenceState === "Louisiana" &&
      workState &&
      workState !== "Louisiana" &&
      ZERO_WAGE_TAX_STATES.has(workState)
    ) {
      warnings.push(
        "Louisiana residents working in a no-income-tax state generally remain subject to Louisiana withholding, which this calculator continues to model."
      )
    }

    return createStateCalculationResult("Louisiana withholding tables and formulas", "dedicated", {
      stateTax: calculateLouisianaWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        filingStatus: context.filingStatus,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        louisianaDeductionClaim: context.profile.louisianaDeductionClaim,
      }),
      warnings,
    })
  },
}
