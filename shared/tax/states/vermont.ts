import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type VermontPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

type VermontBracket = {
  upper: number | null
  lower: number
  baseTax: number
  rate: number
}

const VERMONT_ALLOWANCE_VALUE = 5_400

// The official 2026 Vermont payroll booklet confirms the allowance increased to $5,400
// and the payroll brackets changed. The exact 2026 bracket table was not directly retrievable
// in-tool, so these annual thresholds use the latest published Vermont payroll structure.
const VERMONT_SINGLE_BRACKETS: VermontBracket[] = [
  { upper: 3_825, lower: 0, baseTax: 0, rate: 0.0335 },
  { upper: 53_225, lower: 3_825, baseTax: 0, rate: 0.0335 },
  { upper: 123_525, lower: 53_225, baseTax: 1_654.9, rate: 0.066 },
  { upper: 253_525, lower: 123_525, baseTax: 6_294.7, rate: 0.076 },
  { upper: null, lower: 253_525, baseTax: 16_174.7, rate: 0.0875 },
]

const VERMONT_MARRIED_BRACKETS: VermontBracket[] = [
  { upper: 11_475, lower: 0, baseTax: 0, rate: 0.0335 },
  { upper: 93_975, lower: 11_475, baseTax: 0, rate: 0.0335 },
  { upper: 210_925, lower: 93_975, baseTax: 2_763.75, rate: 0.066 },
  { upper: 315_475, lower: 210_925, baseTax: 10_482.45, rate: 0.076 },
  { upper: null, lower: 315_475, baseTax: 18_428.25, rate: 0.0875 },
]

function getPeriodsPerYear(freq: VermontPayrollFrequency): number {
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

function useVermontMarriedStatus(filingStatus: FilingStatus): boolean {
  return filingStatus === "marriedJoint" || filingStatus === "marriedSeparate"
}

function calculateFromBrackets(amount: number, brackets: VermontBracket[]): number {
  for (const bracket of brackets) {
    if (bracket.upper == null || amount <= bracket.upper) {
      return bracket.baseTax + (amount - bracket.lower) * bracket.rate
    }
  }

  return 0
}

export function isVermontWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return primaryState === "Vermont" || residenceState === "Vermont" || workState === "Vermont"
}

export function calculateVermontWithholding(profile: {
  taxableIncome: number
  filingStatus: FilingStatus
  payFrequency: VermontPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  vermontWithholdingExemptions?: number
  stateWithholdingExemptions?: number
  additionalFederalWithholding?: number
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")

  if (
    primaryState !== "Vermont" &&
    residenceState !== "Vermont" &&
    workState !== "Vermont"
  ) {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualTaxableWages = clampNonNegative(
    d(profile.taxableIncome)
      .mul(periods)
      .sub(
        d(
          profile.vermontWithholdingExemptions ?? profile.stateWithholdingExemptions ?? 0
        ).mul(VERMONT_ALLOWANCE_VALUE)
      )
  ).toNumber()
  const annualTax = calculateFromBrackets(
    annualTaxableWages,
    useVermontMarriedStatus(profile.filingStatus)
      ? VERMONT_MARRIED_BRACKETS
      : VERMONT_SINGLE_BRACKETS
  )
  const perPeriodTax = d(annualTax).div(periods)
  const federalExtraAdjustment = d(profile.additionalFederalWithholding ?? 0).mul(0.3)

  return perPeriodTax.add(federalExtraAdjustment).toDecimalPlaces(2).toNumber()
}

export const vermontStrategy: StateTaxStrategy = {
  stateCode: "Vermont",
  applies: (context) => isVermontWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = [
      "Vermont withholding here uses the updated $5,400 allowance value and the latest published Vermont payroll bracket structure available in-tool, but the exact 2026 state-issued bracket table could not be retrieved directly during implementation."
    ]

    if (residenceState !== "Vermont" && workState === "Vermont") {
      warnings.push(
        "Vermont nonresident withholding should be reduced by the ratio of Vermont work hours to total work hours when wages cover services performed both inside and outside Vermont, and that hour-by-hour allocation is not modeled yet."
      )
    }

    if (residenceState === "Vermont" && workState !== "Vermont") {
      warnings.push(
        "Vermont residents working in another state can reduce Vermont withholding by income tax already withheld to that other state, but this cross-state offset is not modeled yet."
      )
    }

    return createStateCalculationResult("Vermont payroll withholding allowance method", "dedicated", {
      stateTax: calculateVermontWithholding({
        taxableIncome: context.taxableIncome,
        filingStatus: context.filingStatus,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        vermontWithholdingExemptions: context.profile.vermontWithholdingExemptions,
        stateWithholdingExemptions: context.profile.stateWithholdingExemptions,
        additionalFederalWithholding: context.profile.additionalFederalWithholding,
      }),
      warnings,
    })
  },
}
