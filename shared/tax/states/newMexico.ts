import { d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type NewMexicoPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

type NewMexicoBracket = {
  min: number
  max: number | null
  base: number
  rate: number
}

const NEW_MEXICO_ANNUAL_TABLE: Record<"single" | "married" | "headOfHousehold", NewMexicoBracket[]> = {
  single: [
    { min: 0, max: 7_500, base: 0, rate: 0 },
    { min: 7_500, max: 13_000, base: 0, rate: 0.015 },
    { min: 13_000, max: 20_000, base: 82.5, rate: 0.032 },
    { min: 20_000, max: 24_000, base: 306.5, rate: 0.032 },
    { min: 24_000, max: 33_000, base: 434.5, rate: 0.043 },
    { min: 33_000, max: 41_000, base: 821.5, rate: 0.043 },
    { min: 41_000, max: 58_000, base: 1_165.5, rate: 0.047 },
    { min: 58_000, max: 74_000, base: 1_964.5, rate: 0.047 },
    { min: 74_000, max: 217_500, base: 2_716.5, rate: 0.049 },
    { min: 217_500, max: null, base: 9_748, rate: 0.059 },
  ],
  married: [
    { min: 0, max: 15_000, base: 0, rate: 0 },
    { min: 15_000, max: 23_000, base: 0, rate: 0.015 },
    { min: 23_000, max: 31_000, base: 120, rate: 0.032 },
    { min: 31_000, max: 40_000, base: 376, rate: 0.032 },
    { min: 40_000, max: 56_000, base: 664, rate: 0.043 },
    { min: 56_000, max: 65_000, base: 1_352, rate: 0.043 },
    { min: 65_000, max: 101_000, base: 1_739, rate: 0.047 },
    { min: 101_000, max: 115_000, base: 3_431, rate: 0.047 },
    { min: 115_000, max: 330_000, base: 4_089, rate: 0.049 },
    { min: 330_000, max: null, base: 14_624, rate: 0.059 },
  ],
  headOfHousehold: [
    { min: 0, max: 11_250, base: 0, rate: 0 },
    { min: 11_250, max: 19_250, base: 0, rate: 0.015 },
    { min: 19_250, max: 27_250, base: 120, rate: 0.032 },
    { min: 27_250, max: 36_250, base: 376, rate: 0.032 },
    { min: 36_250, max: 52_250, base: 664, rate: 0.043 },
    { min: 52_250, max: 61_250, base: 1_352, rate: 0.043 },
    { min: 61_250, max: 97_250, base: 1_739, rate: 0.047 },
    { min: 97_250, max: 111_250, base: 3_431, rate: 0.047 },
    { min: 111_250, max: 326_250, base: 4_089, rate: 0.049 },
    { min: 326_250, max: null, base: 14_624, rate: 0.059 },
  ],
}

function getPeriodsPerYear(freq: NewMexicoPayrollFrequency): number {
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

function getNewMexicoTableKey(
  filingStatus: FilingStatus,
  higherSingleRate?: boolean
): keyof typeof NEW_MEXICO_ANNUAL_TABLE {
  if (higherSingleRate) {
    return "single"
  }

  switch (filingStatus) {
    case "marriedJoint":
      return "married"
    case "headOfHousehold":
      return "headOfHousehold"
    case "single":
    case "marriedSeparate":
      return "single"
  }
}

function getNewMexicoBracket(
  annualWages: number,
  filingStatus: FilingStatus,
  higherSingleRate?: boolean
): NewMexicoBracket {
  const table = NEW_MEXICO_ANNUAL_TABLE[getNewMexicoTableKey(filingStatus, higherSingleRate)]

  return (
    table.find((bracket) => annualWages >= bracket.min && (bracket.max == null || annualWages <= bracket.max)) ??
    table[table.length - 1]
  )
}

export function isNewMexicoWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  if (primaryState) {
    return primaryState === "NewMexico"
  }

  return residenceState === "NewMexico" || workState === "NewMexico"
}

export function calculateNewMexicoWithholding(profile: {
  taxableIncome: number
  payFrequency: NewMexicoPayrollFrequency
  filingStatus: FilingStatus
  state?: string
  residenceState?: string
  workState?: string
  newMexicoHigherSingleRate?: boolean
  newMexicoExempt?: boolean
  newMexicoMilitarySpouseExempt?: boolean
  newMexicoNativeAmericanExempt?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")

  if (
    profile.newMexicoExempt ||
    profile.newMexicoMilitarySpouseExempt ||
    profile.newMexicoNativeAmericanExempt
  ) {
    return 0
  }

  if (primaryState !== "NewMexico" && residenceState !== "NewMexico" && workState !== "NewMexico") {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualWages = d(profile.taxableIncome).mul(periods).toNumber()
  const bracket = getNewMexicoBracket(
    annualWages,
    profile.filingStatus,
    profile.newMexicoHigherSingleRate
  )
  const annualWithholding =
    bracket.base + Math.max(0, annualWages - bracket.min) * bracket.rate

  return d(annualWithholding).div(periods).toDecimalPlaces(2).toNumber()
}

export const newMexicoStrategy: StateTaxStrategy = {
  stateCode: "NewMexico",
  applies: (context) => isNewMexicoWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (context.profile.newMexicoMilitarySpouseExempt) {
      warnings.push(
        "New Mexico military spouse exemption applies only when the employee qualifies to keep an out-of-state residence under federal military spouse relief rules."
      )
    }

    if (context.profile.newMexicoNativeAmericanExempt) {
      warnings.push(
        "New Mexico Native American wage exemption applies only to income earned on the lands of the employee's own federally recognized New Mexico tribe or pueblo while domiciled there."
      )
    }

    if (context.filingStatus === "marriedJoint" && context.profile.newMexicoHigherSingleRate) {
      warnings.push(
        "This New Mexico estimate uses the higher single withholding table for a married employee because that election was turned on."
      )
    }

    if (residenceState === "NewMexico" && workState && workState !== "NewMexico") {
      warnings.push(
        "New Mexico resident employees working in another state can still require New Mexico resident return adjustments or credits that are not fully reflected in payroll withholding alone."
      )
    }

    return createStateCalculationResult("New Mexico FYI-104 payroll withholding", "dedicated", {
      stateTax: calculateNewMexicoWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        filingStatus: context.filingStatus,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        newMexicoHigherSingleRate: context.profile.newMexicoHigherSingleRate,
        newMexicoExempt: context.profile.newMexicoExempt,
        newMexicoMilitarySpouseExempt: context.profile.newMexicoMilitarySpouseExempt,
        newMexicoNativeAmericanExempt: context.profile.newMexicoNativeAmericanExempt,
      }),
      warnings,
    })
  },
}
