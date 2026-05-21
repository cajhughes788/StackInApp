import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type GeorgiaPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

const GEORGIA_RATE = 0.0519
const GEORGIA_ALLOWANCE_VALUE = 4000

function getPeriodsPerYear(freq: GeorgiaPayrollFrequency): number {
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

function getGeorgiaStandardDeduction(
  filingStatus: FilingStatus,
  marriedBothWorking?: boolean
): number {
  switch (filingStatus) {
    case "marriedJoint":
      return marriedBothWorking ? 12000 : 24000
    case "single":
    case "marriedSeparate":
    case "headOfHousehold":
      return 12000
  }
}

export function isGeorgiaWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const state = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    state === "Georgia" ||
    residenceState === "Georgia" ||
    workState === "Georgia"
  )
}

export function calculateGeorgiaWithholding(profile: {
  taxableIncome: number
  filingStatus: FilingStatus
  dependents?: number
  payFrequency: GeorgiaPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  georgiaAllowanceCount?: number
  georgiaMarriedBothWorking?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(
    profile.residenceState ?? profile.state ?? ""
  )
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isGeorgiaResident = residenceState === "Georgia"
  const isGeorgiaWork = workState === "Georgia"

  if (!isGeorgiaResident && !isGeorgiaWork && primaryState !== "Georgia") {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualWages = d(profile.taxableIncome).mul(periods)
  const annualStandardDeduction = d(
    getGeorgiaStandardDeduction(
      profile.filingStatus,
      profile.georgiaMarriedBothWorking
    )
  )
  const allowanceCount = profile.georgiaAllowanceCount ?? profile.dependents ?? 0
  const annualAllowanceDeduction = d(GEORGIA_ALLOWANCE_VALUE).mul(allowanceCount)
  const annualTaxableWages = clampNonNegative(
    annualWages.sub(annualStandardDeduction).sub(annualAllowanceDeduction)
  )

  return annualTaxableWages
    .mul(GEORGIA_RATE)
    .div(periods)
    .toDecimalPlaces(2)
    .toNumber()
}

export const georgiaStrategy: StateTaxStrategy = {
  stateCode: "Georgia",
  applies: (context) => isGeorgiaWithholdingState(context),
  calculate: (context) =>
    createStateCalculationResult("Georgia dedicated payroll withholding", "dedicated", {
      stateTax: calculateGeorgiaWithholding({
        taxableIncome: context.taxableIncome,
        filingStatus: context.filingStatus,
        dependents: context.dependents,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        georgiaAllowanceCount: context.profile.georgiaAllowanceCount,
        georgiaMarriedBothWorking: context.profile.georgiaMarriedBothWorking,
      }),
    }),
}
