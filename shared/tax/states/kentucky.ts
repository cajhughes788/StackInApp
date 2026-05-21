import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { StateTaxStrategy, TaxProfileInput } from "../types"

type KentuckyPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

const KENTUCKY_RATE = 0.035
const KENTUCKY_STANDARD_DEDUCTION = 3360
const KENTUCKY_RECIPROCAL_STATES = new Set([
  "Illinois",
  "Indiana",
  "Michigan",
  "Ohio",
  "Virginia",
  "WestVirginia",
  "Wisconsin",
])

function getPeriodsPerYear(freq: KentuckyPayrollFrequency): number {
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

export function isKentuckyWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const state = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    state === "Kentucky" ||
    residenceState === "Kentucky" ||
    workState === "Kentucky"
  )
}

export function calculateKentuckyWithholding(profile: {
  taxableIncome: number
  payFrequency: KentuckyPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  reciprocityElection?: boolean
}): number {
  const residenceState = normalizeStateKey(
    profile.residenceState ?? profile.state ?? ""
  )
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isKentuckyResident = residenceState === "Kentucky"
  const isKentuckyWork = workState === "Kentucky"

  if (!isKentuckyResident && !isKentuckyWork) {
    return 0
  }

  if (
    !isKentuckyResident &&
    isKentuckyWork &&
    profile.reciprocityElection === true &&
    KENTUCKY_RECIPROCAL_STATES.has(residenceState)
  ) {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualWages = d(profile.taxableIncome).mul(periods)
  const annualTaxableWages = clampNonNegative(
    annualWages.sub(KENTUCKY_STANDARD_DEDUCTION)
  )

  return annualTaxableWages
    .mul(KENTUCKY_RATE)
    .div(periods)
    .toDecimalPlaces(2)
    .toNumber()
}

export const kentuckyStrategy: StateTaxStrategy = {
  stateCode: "Kentucky",
  applies: (context) => isKentuckyWithholdingState(context),
  calculate: (context) =>
    createStateCalculationResult("Kentucky dedicated payroll withholding", "dedicated", {
      stateTax: calculateKentuckyWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        reciprocityElection: context.reciprocityElection,
      }),
    }),
}
