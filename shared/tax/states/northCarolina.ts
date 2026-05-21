import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type NorthCarolinaPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

const NORTH_CAROLINA_WITHHOLDING_RATE = 0.0409
const NORTH_CAROLINA_ALLOWANCE_VALUE = 2500

function getPeriodsPerYear(freq: NorthCarolinaPayrollFrequency): number {
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

function getNorthCarolinaStandardDeduction(filingStatus: FilingStatus): number {
  switch (filingStatus) {
    case "headOfHousehold":
      return 19125
    case "single":
    case "marriedJoint":
    case "marriedSeparate":
      return 12750
  }
}

export function isNorthCarolinaWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const state = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    state === "NorthCarolina" ||
    residenceState === "NorthCarolina" ||
    workState === "NorthCarolina"
  )
}

export function calculateNorthCarolinaWithholding(profile: {
  taxableIncome: number
  payFrequency: NorthCarolinaPayrollFrequency
  filingStatus: FilingStatus
  state?: string
  residenceState?: string
  workState?: string
  northCarolinaAllowances?: number
}): number {
  const residenceState = normalizeStateKey(
    profile.residenceState ?? profile.state ?? ""
  )
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isNorthCarolinaResident = residenceState === "NorthCarolina"
  const isNorthCarolinaWork = workState === "NorthCarolina"

  if (!isNorthCarolinaResident && !isNorthCarolinaWork) {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualWages = d(profile.taxableIncome).mul(periods)
  const annualTaxableWages = clampNonNegative(
    annualWages
      .sub(getNorthCarolinaStandardDeduction(profile.filingStatus))
      .sub(d(profile.northCarolinaAllowances ?? 0).mul(NORTH_CAROLINA_ALLOWANCE_VALUE))
  )

  return annualTaxableWages
    .mul(NORTH_CAROLINA_WITHHOLDING_RATE)
    .div(periods)
    .toDecimalPlaces(0)
    .toNumber()
}

export const northCarolinaStrategy: StateTaxStrategy = {
  stateCode: "NorthCarolina",
  applies: (context) => isNorthCarolinaWithholdingState(context),
  calculate: (context) =>
    createStateCalculationResult("North Carolina dedicated payroll withholding", "dedicated", {
      stateTax: calculateNorthCarolinaWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        filingStatus: context.filingStatus,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        northCarolinaAllowances: context.profile.northCarolinaAllowances,
      }),
    }),
}
