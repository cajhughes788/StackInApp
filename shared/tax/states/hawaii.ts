import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type HawaiiPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

type HawaiiBracket = {
  min: number
  max: number | null
  base: number
  rate: number
}

const HAWAII_ALLOWANCE_VALUE = {
  weekly: 22,
  biweekly: 44,
  "semi-monthly": 47.67,
  monthly: 95.33,
  annual: 1_144,
} satisfies Record<HawaiiPayrollFrequency, number>

const HAWAII_EXTRA_ALLOWANCE = {
  weekly: 83.65,
  biweekly: 167.31,
  "semi-monthly": 181.25,
  monthly: 362.5,
  annual: 4_350,
} satisfies Record<HawaiiPayrollFrequency, number>

const SINGLE_BRACKETS: Record<HawaiiPayrollFrequency, HawaiiBracket[]> = {
  annual: [
    { min: 0, max: 9_600, base: 0, rate: 0.014 },
    { min: 9_600, max: 14_400, base: 134, rate: 0.032 },
    { min: 14_400, max: 19_200, base: 288, rate: 0.055 },
    { min: 19_200, max: 24_000, base: 552, rate: 0.064 },
    { min: 24_000, max: 36_000, base: 859, rate: 0.068 },
    { min: 36_000, max: 48_000, base: 1_675, rate: 0.072 },
    { min: 48_000, max: 125_000, base: 2_539, rate: 0.076 },
    { min: 125_000, max: null, base: 8_391, rate: 0.079 },
  ],
  weekly: [
    { min: 0, max: 185, base: 0, rate: 0.014 },
    { min: 185, max: 277, base: 2.59, rate: 0.032 },
    { min: 277, max: 369, base: 5.53, rate: 0.055 },
    { min: 369, max: 462, base: 10.59, rate: 0.064 },
    { min: 462, max: 692, base: 16.54, rate: 0.068 },
    { min: 692, max: 923, base: 32.18, rate: 0.072 },
    { min: 923, max: 2_404, base: 48.81, rate: 0.076 },
    { min: 2_404, max: null, base: 161.37, rate: 0.079 },
  ],
  biweekly: [
    { min: 0, max: 369, base: 0, rate: 0.014 },
    { min: 369, max: 554, base: 5.17, rate: 0.032 },
    { min: 554, max: 738, base: 11.09, rate: 0.055 },
    { min: 738, max: 923, base: 21.21, rate: 0.064 },
    { min: 923, max: 1_385, base: 33.05, rate: 0.068 },
    { min: 1_385, max: 1_846, base: 64.47, rate: 0.072 },
    { min: 1_846, max: 4_808, base: 97.66, rate: 0.076 },
    { min: 4_808, max: null, base: 322.77, rate: 0.079 },
  ],
  "semi-monthly": [
    { min: 0, max: 400, base: 0, rate: 0.014 },
    { min: 400, max: 600, base: 5.6, rate: 0.032 },
    { min: 600, max: 800, base: 12, rate: 0.055 },
    { min: 800, max: 1_000, base: 23, rate: 0.064 },
    { min: 1_000, max: 1_500, base: 35.8, rate: 0.068 },
    { min: 1_500, max: 2_000, base: 69.8, rate: 0.072 },
    { min: 2_000, max: 5_208, base: 105.8, rate: 0.076 },
    { min: 5_208, max: null, base: 349.61, rate: 0.079 },
  ],
  monthly: [
    { min: 0, max: 800, base: 0, rate: 0.014 },
    { min: 800, max: 1_200, base: 11.2, rate: 0.032 },
    { min: 1_200, max: 1_600, base: 24, rate: 0.055 },
    { min: 1_600, max: 2_000, base: 46, rate: 0.064 },
    { min: 2_000, max: 3_000, base: 71.6, rate: 0.068 },
    { min: 3_000, max: 4_000, base: 139.6, rate: 0.072 },
    { min: 4_000, max: 10_417, base: 211.6, rate: 0.076 },
    { min: 10_417, max: null, base: 699.29, rate: 0.079 },
  ],
}

const MARRIED_BRACKETS: Record<HawaiiPayrollFrequency, HawaiiBracket[]> = {
  annual: [
    { min: 0, max: 19_200, base: 0, rate: 0.014 },
    { min: 19_200, max: 28_800, base: 269, rate: 0.032 },
    { min: 28_800, max: 38_400, base: 576, rate: 0.055 },
    { min: 38_400, max: 48_000, base: 1_104, rate: 0.064 },
    { min: 48_000, max: 72_000, base: 1_718, rate: 0.068 },
    { min: 72_000, max: 96_000, base: 3_350, rate: 0.072 },
    { min: 96_000, max: 250_000, base: 5_078, rate: 0.076 },
    { min: 250_000, max: null, base: 16_782, rate: 0.079 },
  ],
  weekly: [
    { min: 0, max: 369, base: 0, rate: 0.014 },
    { min: 369, max: 554, base: 5.17, rate: 0.032 },
    { min: 554, max: 738, base: 11.09, rate: 0.055 },
    { min: 738, max: 923, base: 21.21, rate: 0.064 },
    { min: 923, max: 1_385, base: 33.05, rate: 0.068 },
    { min: 1_385, max: 1_846, base: 64.47, rate: 0.072 },
    { min: 1_846, max: 4_808, base: 97.66, rate: 0.076 },
    { min: 4_808, max: null, base: 322.77, rate: 0.079 },
  ],
  biweekly: [
    { min: 0, max: 738, base: 0, rate: 0.014 },
    { min: 738, max: 1_108, base: 10.33, rate: 0.032 },
    { min: 1_108, max: 1_477, base: 22.17, rate: 0.055 },
    { min: 1_477, max: 1_846, base: 42.47, rate: 0.064 },
    { min: 1_846, max: 2_769, base: 66.09, rate: 0.068 },
    { min: 2_769, max: 3_692, base: 128.85, rate: 0.072 },
    { min: 3_692, max: 9_615, base: 195.31, rate: 0.076 },
    { min: 9_615, max: null, base: 645.46, rate: 0.079 },
  ],
  "semi-monthly": [
    { min: 0, max: 800, base: 0, rate: 0.014 },
    { min: 800, max: 1_200, base: 11.2, rate: 0.032 },
    { min: 1_200, max: 1_600, base: 24, rate: 0.055 },
    { min: 1_600, max: 2_000, base: 46, rate: 0.064 },
    { min: 2_000, max: 3_000, base: 71.6, rate: 0.068 },
    { min: 3_000, max: 4_000, base: 139.6, rate: 0.072 },
    { min: 4_000, max: 10_417, base: 211.6, rate: 0.076 },
    { min: 10_417, max: null, base: 699.29, rate: 0.079 },
  ],
  monthly: [
    { min: 0, max: 1_600, base: 0, rate: 0.014 },
    { min: 1_600, max: 2_400, base: 22.4, rate: 0.032 },
    { min: 2_400, max: 3_200, base: 48, rate: 0.055 },
    { min: 3_200, max: 4_000, base: 92, rate: 0.064 },
    { min: 4_000, max: 6_000, base: 143.2, rate: 0.068 },
    { min: 6_000, max: 8_000, base: 279.2, rate: 0.072 },
    { min: 8_000, max: 20_833, base: 423.2, rate: 0.076 },
    { min: 20_833, max: null, base: 1_398.51, rate: 0.079 },
  ],
}

function useHawaiiMarriedRate(
  filingStatus: FilingStatus,
  hawaiiHigherSingleRate?: boolean
): boolean {
  return filingStatus === "marriedJoint" && !hawaiiHigherSingleRate
}

function calculateBracketTax(amount: number, brackets: HawaiiBracket[]): number {
  const bracket = brackets.find(
    ({ min, max }) => amount >= min && (max == null || amount < max)
  )

  if (!bracket) {
    return 0
  }

  return bracket.base + bracket.rate * (amount - bracket.min)
}

export function isHawaiiWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return primaryState === "Hawaii" || residenceState === "Hawaii" || workState === "Hawaii"
}

export function calculateHawaiiWithholding(profile: {
  taxableIncome: number
  filingStatus: FilingStatus
  payFrequency: HawaiiPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  hawaiiWithholdingExemptions?: number
  stateWithholdingExemptions?: number
  hawaiiHigherSingleRate?: boolean
  hawaiiCertifiedDisabled?: boolean
  hawaiiNonresidentMilitarySpouse?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")

  if (primaryState !== "Hawaii" && residenceState !== "Hawaii" && workState !== "Hawaii") {
    return 0
  }

  if (profile.hawaiiCertifiedDisabled || profile.hawaiiNonresidentMilitarySpouse) {
    return 0
  }

  const adjustedWages = clampNonNegative(
    d(profile.taxableIncome)
      .sub(
        d(
          profile.hawaiiWithholdingExemptions
          ?? profile.stateWithholdingExemptions
          ?? 0
        ).mul(HAWAII_ALLOWANCE_VALUE[profile.payFrequency])
      )
      .sub(HAWAII_EXTRA_ALLOWANCE[profile.payFrequency])
  ).toNumber()
  const brackets = useHawaiiMarriedRate(profile.filingStatus, profile.hawaiiHigherSingleRate)
    ? MARRIED_BRACKETS[profile.payFrequency]
    : SINGLE_BRACKETS[profile.payFrequency]

  return d(calculateBracketTax(adjustedWages, brackets)).toDecimalPlaces(2).toNumber()
}

export const hawaiiStrategy: StateTaxStrategy = {
  stateCode: "Hawaii",
  applies: (context) => isHawaiiWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (residenceState !== "Hawaii" && workState === "Hawaii") {
      warnings.push(
        "Hawaii withholding can require additional nonresident allocation and sourcing details when only part of annual wages are Hawaii-source, which this calculator does not fully track yet."
      )
    }

    return createStateCalculationResult("Hawaii Booklet A 2026 withholding tables", "dedicated", {
      stateTax: calculateHawaiiWithholding({
        taxableIncome: context.taxableIncome,
        filingStatus: context.filingStatus,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        hawaiiWithholdingExemptions: context.profile.hawaiiWithholdingExemptions,
        stateWithholdingExemptions: context.profile.stateWithholdingExemptions,
        hawaiiHigherSingleRate: context.profile.hawaiiHigherSingleRate,
        hawaiiCertifiedDisabled: context.profile.hawaiiCertifiedDisabled,
        hawaiiNonresidentMilitarySpouse: context.profile.hawaiiNonresidentMilitarySpouse,
      }),
      warnings,
    })
  },
}
