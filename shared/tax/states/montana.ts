import { FEDERAL_2026 } from "../tables/federal2026"
import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type MontanaPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

type MontanaBracket = {
  min: number
  max: number | null
  base: number
  rate: number
}

const MONTANA_RECIPROCITY_STATES = new Set(["NorthDakota"])

const SINGLE_BRACKETS: Record<MontanaPayrollFrequency, MontanaBracket[]> = {
  monthly: [
    { min: 0, max: 1_342, base: 0, rate: 0 },
    { min: 1_342, max: 5_300, base: 0, rate: 0.047 },
    { min: 5_300, max: null, base: 187, rate: 0.0565 },
  ],
  "semi-monthly": [
    { min: 0, max: 671, base: 0, rate: 0 },
    { min: 671, max: 2_650, base: 0, rate: 0.047 },
    { min: 2_650, max: null, base: 94, rate: 0.0565 },
  ],
  biweekly: [
    { min: 0, max: 619, base: 0, rate: 0 },
    { min: 619, max: 2_446, base: 0, rate: 0.047 },
    { min: 2_446, max: null, base: 86, rate: 0.0565 },
  ],
  weekly: [
    { min: 0, max: 310, base: 0, rate: 0 },
    { min: 310, max: 1_223, base: 0, rate: 0.047 },
    { min: 1_223, max: null, base: 43, rate: 0.0565 },
  ],
  annual: [
    { min: 0, max: 16_100, base: 0, rate: 0 },
    { min: 16_100, max: 63_600, base: 0, rate: 0.047 },
    { min: 63_600, max: null, base: 2_233, rate: 0.0565 },
  ],
}

const MARRIED_JOINT_BRACKETS: Record<MontanaPayrollFrequency, MontanaBracket[]> = {
  monthly: [
    { min: 0, max: 2_683, base: 0, rate: 0 },
    { min: 2_683, max: 10_600, base: 0, rate: 0.047 },
    { min: 10_600, max: null, base: 372, rate: 0.0565 },
  ],
  "semi-monthly": [
    { min: 0, max: 1_342, base: 0, rate: 0 },
    { min: 1_342, max: 5_300, base: 0, rate: 0.047 },
    { min: 5_300, max: null, base: 187, rate: 0.0565 },
  ],
  biweekly: [
    { min: 0, max: 1_238, base: 0, rate: 0 },
    { min: 1_238, max: 4_892, base: 0, rate: 0.047 },
    { min: 4_892, max: null, base: 172, rate: 0.0565 },
  ],
  weekly: [
    { min: 0, max: 619, base: 0, rate: 0 },
    { min: 619, max: 2_446, base: 0, rate: 0.047 },
    { min: 2_446, max: null, base: 86, rate: 0.0565 },
  ],
  annual: [
    { min: 0, max: 32_200, base: 0, rate: 0 },
    { min: 32_200, max: 127_200, base: 0, rate: 0.047 },
    { min: 127_200, max: null, base: 4_465, rate: 0.0565 },
  ],
}

const HEAD_OF_HOUSEHOLD_BRACKETS: Record<MontanaPayrollFrequency, MontanaBracket[]> = {
  monthly: [
    { min: 0, max: 2_013, base: 0, rate: 0 },
    { min: 2_013, max: 7_950, base: 0, rate: 0.047 },
    { min: 7_950, max: null, base: 280, rate: 0.0565 },
  ],
  "semi-monthly": [
    { min: 0, max: 1_006, base: 0, rate: 0 },
    { min: 1_006, max: 3_975, base: 0, rate: 0.047 },
    { min: 3_975, max: null, base: 140, rate: 0.0565 },
  ],
  biweekly: [
    { min: 0, max: 929, base: 0, rate: 0 },
    { min: 929, max: 3_669, base: 0, rate: 0.047 },
    { min: 3_669, max: null, base: 129, rate: 0.0565 },
  ],
  weekly: [
    { min: 0, max: 464, base: 0, rate: 0 },
    { min: 464, max: 1_835, base: 0, rate: 0.047 },
    { min: 1_835, max: null, base: 65, rate: 0.0565 },
  ],
  annual: [
    { min: 0, max: 24_150, base: 0, rate: 0 },
    { min: 24_150, max: 95_400, base: 0, rate: 0.047 },
    { min: 95_400, max: null, base: 3_349, rate: 0.0565 },
  ],
}

function getMontanaBrackets(
  filingStatus: FilingStatus,
  montanaBothSpousesWorking: boolean
): Record<MontanaPayrollFrequency, MontanaBracket[]> {
  if (filingStatus === "headOfHousehold") {
    return HEAD_OF_HOUSEHOLD_BRACKETS
  }

  if (filingStatus === "marriedJoint" && !montanaBothSpousesWorking) {
    return MARRIED_JOINT_BRACKETS
  }

  return SINGLE_BRACKETS
}

function calculateBracketTax(amount: number, brackets: MontanaBracket[]): number {
  const bracket = brackets.find(
    ({ min, max }) => amount >= min && (max == null || amount < max)
  )

  if (!bracket) {
    return 0
  }

  return bracket.base + bracket.rate * (amount - bracket.min)
}

function getPeriodsPerYear(freq: MontanaPayrollFrequency): number {
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

export function isMontanaWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return primaryState === "Montana" || residenceState === "Montana" || workState === "Montana"
}

export function calculateMontanaWithholding(profile: {
  taxableIncome: number
  filingStatus: FilingStatus
  payFrequency: MontanaPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  reciprocityElection?: boolean
  montanaBothSpousesWorking?: boolean
  montanaExempt?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isResident = residenceState === "Montana"
  const worksInState = workState === "Montana"

  if (!isResident && !worksInState && primaryState !== "Montana") {
    return 0
  }

  if (profile.montanaExempt) {
    return 0
  }

  if (
    !isResident &&
    worksInState &&
    profile.reciprocityElection &&
    MONTANA_RECIPROCITY_STATES.has(residenceState)
  ) {
    return 0
  }

  const standardDeductionPerPeriod = d(FEDERAL_2026[profile.filingStatus].standardDeduction).div(
    getPeriodsPerYear(profile.payFrequency)
  )
  const netTaxableEarnings = clampNonNegative(
    d(profile.taxableIncome).sub(standardDeductionPerPeriod)
  ).toNumber()
  const tax = calculateBracketTax(
    netTaxableEarnings,
    getMontanaBrackets(profile.filingStatus, Boolean(profile.montanaBothSpousesWorking))[
      profile.payFrequency
    ]
  )

  return tax <= 0 ? 0 : Math.ceil(tax)
}

export const montanaStrategy: StateTaxStrategy = {
  stateCode: "Montana",
  applies: (context) => isMontanaWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (
      residenceState !== "Montana" &&
      workState === "Montana" &&
      MONTANA_RECIPROCITY_STATES.has(residenceState) &&
      !context.reciprocityElection
    ) {
      warnings.push(
        "Montana reciprocity for North Dakota residents is only applied here when the reciprocity toggle is turned on."
      )
    }

    if (residenceState !== "Montana" && workState === "Montana") {
      warnings.push(
        "Montana also has a 30-day nonresident wage withholding exemption that depends on annual Montana workdays and wages, which this calculator does not track yet."
      )
    }

    return createStateCalculationResult("Montana 2026 withholding table formula", "dedicated", {
      stateTax: calculateMontanaWithholding({
        taxableIncome: context.taxableIncome,
        filingStatus: context.filingStatus,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        reciprocityElection: context.reciprocityElection,
        montanaBothSpousesWorking: context.profile.montanaBothSpousesWorking,
        montanaExempt: context.profile.montanaExempt,
      }),
      warnings,
    })
  },
}
