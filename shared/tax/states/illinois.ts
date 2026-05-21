import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { StateTaxStrategy, TaxProfileInput } from "../types"

type IllinoisPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

const ILLINOIS_WITHHOLDING_RATE = 0.0495
const ILLINOIS_LINE_1_ALLOWANCE = 2925
const ILLINOIS_LINE_2_ALLOWANCE = 1000
const ILLINOIS_RECIPROCAL_STATES = new Set([
  "Iowa",
  "Kentucky",
  "Michigan",
  "Wisconsin",
])

function getPeriodsPerYear(freq: IllinoisPayrollFrequency): number {
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

export function isIllinoisWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const state = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    state === "Illinois" ||
    residenceState === "Illinois" ||
    workState === "Illinois"
  )
}

export function calculateIllinoisWithholding(profile: {
  taxableIncome: number
  payFrequency: IllinoisPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  reciprocityElection?: boolean
  illinoisAllowanceLine1?: number
  illinoisAllowanceLine2?: number
}): number {
  const residenceState = normalizeStateKey(
    profile.residenceState ?? profile.state ?? ""
  )
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isIllinoisResident = residenceState === "Illinois"
  const isIllinoisWork = workState === "Illinois"

  if (!isIllinoisResident && !isIllinoisWork) {
    return 0
  }

  const reciprocalExemptionApplies =
    !isIllinoisResident &&
    isIllinoisWork &&
    (profile.reciprocityElection === true ||
      ILLINOIS_RECIPROCAL_STATES.has(residenceState))

  if (reciprocalExemptionApplies) {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const line1Allowances = profile.illinoisAllowanceLine1 ?? 0
  const line2Allowances = profile.illinoisAllowanceLine2 ?? 0
  const perPeriodAllowance = d(
    line1Allowances * ILLINOIS_LINE_1_ALLOWANCE +
      line2Allowances * ILLINOIS_LINE_2_ALLOWANCE
  ).div(periods)

  const taxableWages = clampNonNegative(d(profile.taxableIncome).sub(perPeriodAllowance))

  return taxableWages
    .mul(ILLINOIS_WITHHOLDING_RATE)
    .toDecimalPlaces(2)
    .toNumber()
}

export const illinoisStrategy: StateTaxStrategy = {
  stateCode: "Illinois",
  applies: (context) => isIllinoisWithholdingState(context),
  calculate: (context) =>
    createStateCalculationResult("Illinois dedicated payroll withholding", "dedicated", {
      stateTax: calculateIllinoisWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        reciprocityElection: context.reciprocityElection,
        illinoisAllowanceLine1: context.profile.illinoisAllowanceLine1,
        illinoisAllowanceLine2: context.profile.illinoisAllowanceLine2,
      }),
    }),
}
