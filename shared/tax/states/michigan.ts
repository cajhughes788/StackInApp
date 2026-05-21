import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { StateTaxStrategy, TaxProfileInput } from "../types"

type MichiganPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

const MICHIGAN_RATE = 0.0425
const MICHIGAN_PERSONAL_EXEMPTION = 5900
const MICHIGAN_RECIPROCAL_STATES = new Set([
  "Illinois",
  "Indiana",
  "Kentucky",
  "Minnesota",
  "Ohio",
  "Wisconsin",
])

function getPeriodsPerYear(freq: MichiganPayrollFrequency): number {
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

export function isMichiganWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const state = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    state === "Michigan" ||
    residenceState === "Michigan" ||
    workState === "Michigan"
  )
}

export function calculateMichiganWithholding(profile: {
  taxableIncome: number
  payFrequency: MichiganPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  reciprocityElection?: boolean
  michiganExemptions?: number
}): number {
  const residenceState = normalizeStateKey(
    profile.residenceState ?? profile.state ?? ""
  )
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isMichiganResident = residenceState === "Michigan"
  const isMichiganWork = workState === "Michigan"

  if (!isMichiganResident && !isMichiganWork) {
    return 0
  }

  if (
    !isMichiganResident &&
    isMichiganWork &&
    profile.reciprocityElection === true &&
    MICHIGAN_RECIPROCAL_STATES.has(residenceState)
  ) {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const exemptionCount = profile.michiganExemptions ?? 0
  const annualWages = d(profile.taxableIncome).mul(periods)
  const annualTaxableWages = clampNonNegative(
    annualWages.sub(d(MICHIGAN_PERSONAL_EXEMPTION).mul(exemptionCount))
  )

  return annualTaxableWages
    .mul(MICHIGAN_RATE)
    .div(periods)
    .toDecimalPlaces(2)
    .toNumber()
}

export const michiganStrategy: StateTaxStrategy = {
  stateCode: "Michigan",
  applies: (context) => isMichiganWithholdingState(context),
  calculate: (context) =>
    createStateCalculationResult("Michigan dedicated payroll withholding", "dedicated", {
      stateTax: calculateMichiganWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        reciprocityElection: context.reciprocityElection,
        michiganExemptions: context.profile.michiganExemptions,
      }),
    }),
}
