import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type ColoradoPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

const COLORADO_RATE = 0.044
const COLORADO_DEFAULT_DEDUCTION = {
  marriedJoint: 11000,
  other: 5500,
} as const

const NO_STATE_INCOME_TAX_STATES = new Set([
  "Alaska",
  "Florida",
  "Nevada",
  "NewHampshire",
  "SouthDakota",
  "Tennessee",
  "Texas",
  "Washington",
  "Wyoming",
])

function getPeriodsPerYear(freq: ColoradoPayrollFrequency): number {
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

function getDefaultDeduction(filingStatus: FilingStatus): number {
  return filingStatus === "marriedJoint"
    ? COLORADO_DEFAULT_DEDUCTION.marriedJoint
    : COLORADO_DEFAULT_DEDUCTION.other
}

export function isColoradoWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const state = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    state === "Colorado" ||
    residenceState === "Colorado" ||
    workState === "Colorado"
  )
}

export function calculateColoradoWithholding(profile: {
  taxableIncome: number
  filingStatus: FilingStatus
  payFrequency: ColoradoPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  coloradoDeductionAmount?: number
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(
    profile.residenceState ?? profile.state ?? ""
  )
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isColoradoResident = residenceState === "Colorado"
  const isColoradoWork = workState === "Colorado"

  if (!isColoradoResident && !isColoradoWork && primaryState !== "Colorado") {
    return 0
  }

  // Colorado generally does not require Colorado withholding on resident wages
  // earned in another income-tax state that already withholds on those wages.
  if (
    isColoradoResident &&
    workState &&
    workState !== "Colorado" &&
    !NO_STATE_INCOME_TAX_STATES.has(workState) &&
    primaryState !== "Colorado"
  ) {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualWages = d(profile.taxableIncome).mul(periods)
  const annualDeduction = d(
    profile.coloradoDeductionAmount ??
      getDefaultDeduction(profile.filingStatus)
  )
  const annualTaxableWages = clampNonNegative(annualWages.sub(annualDeduction))

  return annualTaxableWages
    .mul(COLORADO_RATE)
    .div(periods)
    .toDecimalPlaces(2)
    .toNumber()
}

export const coloradoStrategy: StateTaxStrategy = {
  stateCode: "Colorado",
  applies: (context) => isColoradoWithholdingState(context),
  calculate: (context) =>
    createStateCalculationResult("Colorado dedicated payroll withholding", "dedicated", {
      stateTax: calculateColoradoWithholding({
        taxableIncome: context.taxableIncome,
        filingStatus: context.filingStatus,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        coloradoDeductionAmount: context.profile.coloradoDeductionAmount,
      }),
    }),
}
