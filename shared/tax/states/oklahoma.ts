import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type OklahomaPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

type OklahomaBracket = {
  upTo: number | null
  rate: number
}

const OKLAHOMA_ANNUAL_ALLOWANCE_VALUE = 1_000
const OKLAHOMA_STANDARD_DEDUCTION: Record<FilingStatus, number> = {
  single: 6_350,
  marriedJoint: 12_700,
  marriedSeparate: 6_350,
  headOfHousehold: 9_525,
}

const OKLAHOMA_BRACKETS: Record<"single" | "married", OklahomaBracket[]> = {
  single: [
    { upTo: 3_750, rate: 0 },
    { upTo: 4_900, rate: 0.025 },
    { upTo: 7_200, rate: 0.035 },
    { upTo: null, rate: 0.045 },
  ],
  married: [
    { upTo: 7_500, rate: 0 },
    { upTo: 9_800, rate: 0.025 },
    { upTo: 14_400, rate: 0.035 },
    { upTo: null, rate: 0.045 },
  ],
}

function getPeriodsPerYear(freq: OklahomaPayrollFrequency): number {
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

function getOklahomaTableKey(
  filingStatus: FilingStatus,
  higherSingleRate?: boolean
): keyof typeof OKLAHOMA_BRACKETS {
  if (higherSingleRate) {
    return "single"
  }

  return filingStatus === "marriedJoint" ? "married" : "single"
}

function getOklahomaStandardDeduction(
  filingStatus: FilingStatus,
  higherSingleRate?: boolean
): number {
  return OKLAHOMA_STANDARD_DEDUCTION[
    higherSingleRate && filingStatus === "marriedJoint" ? "single" : filingStatus
  ]
}

function calculateOklahomaAnnualTax(
  annualTaxableIncome: number,
  filingStatus: FilingStatus,
  higherSingleRate?: boolean
): number {
  const brackets = OKLAHOMA_BRACKETS[getOklahomaTableKey(filingStatus, higherSingleRate)]
  let previousCap = 0
  let remaining = annualTaxableIncome
  let tax = 0

  for (const bracket of brackets) {
    const upperCap = bracket.upTo ?? Number.POSITIVE_INFINITY
    const taxableAtRate = Math.max(0, Math.min(remaining, upperCap - previousCap))

    tax += taxableAtRate * bracket.rate
    remaining -= taxableAtRate
    previousCap = upperCap

    if (remaining <= 0) {
      break
    }
  }

  return tax
}

export function isOklahomaWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  if (primaryState) {
    return primaryState === "Oklahoma"
  }

  return residenceState === "Oklahoma" || workState === "Oklahoma"
}

export function calculateOklahomaWithholding(profile: {
  taxableIncome: number
  payFrequency: OklahomaPayrollFrequency
  filingStatus: FilingStatus
  state?: string
  residenceState?: string
  workState?: string
  oklahomaAllowances?: number
  oklahomaHigherSingleRate?: boolean
  oklahomaAdditionalWithholding?: number
  oklahomaExempt?: boolean
  oklahomaMilitarySpouseExempt?: boolean
  oklahomaMilitaryIncomeExempt?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")

  if (
    profile.oklahomaExempt ||
    profile.oklahomaMilitarySpouseExempt ||
    profile.oklahomaMilitaryIncomeExempt
  ) {
    return 0
  }

  if (primaryState !== "Oklahoma" && residenceState !== "Oklahoma" && workState !== "Oklahoma") {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualGrossIncome = d(profile.taxableIncome).mul(periods)
  const annualTaxableIncome = clampNonNegative(
    annualGrossIncome
      .sub(d(profile.oklahomaAllowances ?? 0).mul(OKLAHOMA_ANNUAL_ALLOWANCE_VALUE))
      .sub(getOklahomaStandardDeduction(profile.filingStatus, profile.oklahomaHigherSingleRate))
  )
  const annualWithholding = calculateOklahomaAnnualTax(
    annualTaxableIncome.toNumber(),
    profile.filingStatus,
    profile.oklahomaHigherSingleRate
  )

  return Math.max(
    0,
    Math.round(annualWithholding / periods + (profile.oklahomaAdditionalWithholding ?? 0))
  )
}

export const oklahomaStrategy: StateTaxStrategy = {
  stateCode: "Oklahoma",
  applies: (context) => isOklahomaWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (context.profile.oklahomaMilitarySpouseExempt) {
      warnings.push(
        "Oklahoma military spouse exemption applies only when the employee qualifies under federal military spouse relief rules and properly claimed the exemption on the Oklahoma withholding form."
      )
    }

    if (context.profile.oklahomaMilitaryIncomeExempt) {
      warnings.push(
        "Oklahoma active-duty military income exemption should be used only for qualifying military compensation that is exempt from Oklahoma individual income tax."
      )
    }

    if (context.filingStatus === "marriedJoint" && context.profile.oklahomaHigherSingleRate) {
      warnings.push(
        "This Oklahoma estimate uses the higher single withholding rate election for a married employee."
      )
    }

    if (residenceState !== "Oklahoma" && workState === "Oklahoma") {
      warnings.push(
        "Oklahoma nonresident withholding can depend on Oklahoma-source wage allocation and a small-pay nonresident exception that is not fully modeled here."
      )
    }

    return createStateCalculationResult("Oklahoma withholding tables and percentage method", "dedicated", {
      stateTax: calculateOklahomaWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        filingStatus: context.filingStatus,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        oklahomaAllowances: context.profile.oklahomaAllowances,
        oklahomaHigherSingleRate: context.profile.oklahomaHigherSingleRate,
        oklahomaAdditionalWithholding: context.profile.oklahomaAdditionalWithholding,
        oklahomaExempt: context.profile.oklahomaExempt,
        oklahomaMilitarySpouseExempt: context.profile.oklahomaMilitarySpouseExempt,
        oklahomaMilitaryIncomeExempt: context.profile.oklahomaMilitaryIncomeExempt,
      }),
      warnings,
    })
  },
}
