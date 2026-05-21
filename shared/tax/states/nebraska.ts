import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type NebraskaPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

type NebraskaBracket = {
  min: number
  max: number | null
  base: number
  rate: number
}

const ALLOWANCE_VALUE = {
  weekly: 46.92,
  biweekly: 93.85,
  "semi-monthly": 101.67,
  monthly: 203.33,
  annual: 2_440,
} satisfies Record<NebraskaPayrollFrequency, number>

const SINGLE_BRACKETS: Record<NebraskaPayrollFrequency, NebraskaBracket[]> = {
  weekly: [
    { min: 0, max: 66, base: 0, rate: 0 },
    { min: 66, max: 129, base: 0, rate: 0.0226 },
    { min: 129, max: 419, base: 1.42, rate: 0.0322 },
    { min: 419, max: 608, base: 10.76, rate: 0.0421 },
    { min: 608, max: 772, base: 18.72, rate: 0.0435 },
    { min: 772, max: 1_449, base: 25.85, rate: 0.0448 },
    { min: 1_449, max: null, base: 56.18, rate: 0.046 },
  ],
  biweekly: [
    { min: 0, max: 132, base: 0, rate: 0 },
    { min: 132, max: 258, base: 0, rate: 0.0226 },
    { min: 258, max: 839, base: 2.85, rate: 0.0322 },
    { min: 839, max: 1_216, base: 21.56, rate: 0.0421 },
    { min: 1_216, max: 1_543, base: 37.43, rate: 0.0435 },
    { min: 1_543, max: 2_899, base: 51.65, rate: 0.0448 },
    { min: 2_899, max: null, base: 112.4, rate: 0.046 },
  ],
  "semi-monthly": [
    { min: 0, max: 143, base: 0, rate: 0 },
    { min: 143, max: 280, base: 0, rate: 0.0226 },
    { min: 280, max: 909, base: 3.1, rate: 0.0322 },
    { min: 909, max: 1_317, base: 23.35, rate: 0.0421 },
    { min: 1_317, max: 1_672, base: 40.53, rate: 0.0435 },
    { min: 1_672, max: 3_140, base: 55.97, rate: 0.0448 },
    { min: 3_140, max: null, base: 121.74, rate: 0.046 },
  ],
  monthly: [
    { min: 0, max: 286, base: 0, rate: 0 },
    { min: 286, max: 559, base: 0, rate: 0.0226 },
    { min: 559, max: 1_818, base: 6.17, rate: 0.0322 },
    { min: 1_818, max: 2_634, base: 46.71, rate: 0.0421 },
    { min: 2_634, max: 3_344, base: 81.06, rate: 0.0435 },
    { min: 3_344, max: 6_281, base: 111.95, rate: 0.0448 },
    { min: 6_281, max: null, base: 243.53, rate: 0.046 },
  ],
  annual: [
    { min: 0, max: 3_430, base: 0, rate: 0 },
    { min: 3_430, max: 6_710, base: 0, rate: 0.0226 },
    { min: 6_710, max: 21_810, base: 74.13, rate: 0.0322 },
    { min: 21_810, max: 31_610, base: 560.35, rate: 0.0421 },
    { min: 31_610, max: 40_130, base: 972.93, rate: 0.0435 },
    { min: 40_130, max: 75_370, base: 1_343.55, rate: 0.0448 },
    { min: 75_370, max: null, base: 2_922.3, rate: 0.046 },
  ],
}

const MARRIED_BRACKETS: Record<NebraskaPayrollFrequency, NebraskaBracket[]> = {
  weekly: [
    { min: 0, max: 158, base: 0, rate: 0 },
    { min: 158, max: 250, base: 0, rate: 0.0226 },
    { min: 250, max: 623, base: 2.08, rate: 0.0322 },
    { min: 623, max: 969, base: 14.09, rate: 0.0421 },
    { min: 969, max: 1_203, base: 28.66, rate: 0.0435 },
    { min: 1_203, max: 1_595, base: 38.84, rate: 0.0448 },
    { min: 1_595, max: null, base: 56.4, rate: 0.046 },
  ],
  biweekly: [
    { min: 0, max: 315, base: 0, rate: 0 },
    { min: 315, max: 500, base: 0, rate: 0.0226 },
    { min: 500, max: 1_246, base: 4.18, rate: 0.0322 },
    { min: 1_246, max: 1_938, base: 28.2, rate: 0.0421 },
    { min: 1_938, max: 2_405, base: 57.33, rate: 0.0435 },
    { min: 2_405, max: 3_189, base: 77.64, rate: 0.0448 },
    { min: 3_189, max: null, base: 112.76, rate: 0.046 },
  ],
  "semi-monthly": [
    { min: 0, max: 341, base: 0, rate: 0 },
    { min: 341, max: 542, base: 0, rate: 0.0226 },
    { min: 542, max: 1_350, base: 4.54, rate: 0.0322 },
    { min: 1_350, max: 2_100, base: 30.56, rate: 0.0421 },
    { min: 2_100, max: 2_605, base: 62.14, rate: 0.0435 },
    { min: 2_605, max: 3_455, base: 84.11, rate: 0.0448 },
    { min: 3_455, max: null, base: 122.19, rate: 0.046 },
  ],
  monthly: [
    { min: 0, max: 683, base: 0, rate: 0 },
    { min: 683, max: 1_084, base: 0, rate: 0.0226 },
    { min: 1_084, max: 2_700, base: 9.06, rate: 0.0322 },
    { min: 2_700, max: 4_200, base: 61.1, rate: 0.0421 },
    { min: 4_200, max: 5_211, base: 124.25, rate: 0.0435 },
    { min: 5_211, max: 6_910, base: 168.23, rate: 0.0448 },
    { min: 6_910, max: null, base: 244.35, rate: 0.046 },
  ],
  annual: [
    { min: 0, max: 8_190, base: 0, rate: 0 },
    { min: 8_190, max: 13_010, base: 0, rate: 0.0226 },
    { min: 13_010, max: 32_400, base: 108.93, rate: 0.0322 },
    { min: 32_400, max: 50_400, base: 733.29, rate: 0.0421 },
    { min: 50_400, max: 62_530, base: 1_491.09, rate: 0.0435 },
    { min: 62_530, max: 82_920, base: 2_018.75, rate: 0.0448 },
    { min: 82_920, max: null, base: 2_932.22, rate: 0.046 },
  ],
}

function calculateBracketTax(amount: number, brackets: NebraskaBracket[]): number {
  const bracket = brackets.find(
    ({ min, max }) => amount >= min && (max == null || amount < max)
  )

  if (!bracket) {
    return 0
  }

  return bracket.base + bracket.rate * (amount - bracket.min)
}

function useMarriedNebraskaTable(filingStatus: FilingStatus): boolean {
  return filingStatus === "marriedJoint"
}

export function isNebraskaWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return primaryState === "Nebraska" || residenceState === "Nebraska" || workState === "Nebraska"
}

export function calculateNebraskaWithholding(profile: {
  taxableIncome: number
  filingStatus: FilingStatus
  payFrequency: NebraskaPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  nebraskaWithholdingExemptions?: number
  stateWithholdingExemptions?: number
  nebraskaExempt?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")

  if (
    primaryState !== "Nebraska" &&
    residenceState !== "Nebraska" &&
    workState !== "Nebraska"
  ) {
    return 0
  }

  if (profile.nebraskaExempt) {
    return 0
  }

  const adjustedWages = clampNonNegative(
    d(profile.taxableIncome).sub(
      d(profile.nebraskaWithholdingExemptions ?? profile.stateWithholdingExemptions ?? 0).mul(
        ALLOWANCE_VALUE[profile.payFrequency]
      )
    )
  ).toNumber()
  const tax = calculateBracketTax(
    adjustedWages,
    (useMarriedNebraskaTable(profile.filingStatus) ? MARRIED_BRACKETS : SINGLE_BRACKETS)[
      profile.payFrequency
    ]
  )

  return d(tax).toDecimalPlaces(2).toNumber()
}

export const nebraskaStrategy: StateTaxStrategy = {
  stateCode: "Nebraska",
  applies: (context) => isNebraskaWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = [
      "Nebraska's special 1.5% minimum withholding rule and shaded versus non-shaded wage-table enforcement are not separately modeled yet in this calculator."
    ]

    if (residenceState !== "Nebraska" && workState === "Nebraska") {
      warnings.push(
        "Nebraska nonresident allocation on Form 9N, the conference-or-training safe harbor, and other multistate special rules are not tracked yet."
      )
    }

    return createStateCalculationResult("Nebraska Circular EN percentage method", "dedicated", {
      stateTax: calculateNebraskaWithholding({
        taxableIncome: context.taxableIncome,
        filingStatus: context.filingStatus,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        nebraskaWithholdingExemptions: context.profile.nebraskaWithholdingExemptions,
        stateWithholdingExemptions: context.profile.stateWithholdingExemptions,
        nebraskaExempt: context.profile.nebraskaExempt,
      }),
      warnings,
    })
  },
}
