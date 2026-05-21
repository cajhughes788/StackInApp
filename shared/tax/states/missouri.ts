import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type MissouriPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

type MissouriBracket = {
  upTo: number | null
  rate: number
}

const MISSOURI_BRACKETS: MissouriBracket[] = [
  { upTo: 1_313, rate: 0 },
  { upTo: 2_626, rate: 0.02 },
  { upTo: 3_939, rate: 0.025 },
  { upTo: 5_252, rate: 0.03 },
  { upTo: 6_565, rate: 0.035 },
  { upTo: 7_878, rate: 0.04 },
  { upTo: 9_191, rate: 0.045 },
  { upTo: null, rate: 0.047 },
]

function getPeriodsPerYear(freq: MissouriPayrollFrequency): number {
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

function getMissouriStandardDeduction(
  filingStatus: FilingStatus,
  spouseDoesNotWork?: boolean
): number {
  if (filingStatus === "marriedJoint" && spouseDoesNotWork) {
    return 32_200
  }

  switch (filingStatus) {
    case "headOfHousehold":
      return 24_150
    case "single":
    case "marriedJoint":
    case "marriedSeparate":
      return 16_100
  }
}

function calculateMissouriAnnualTax(annualTaxableIncome: number): number {
  let remaining = annualTaxableIncome
  let previousCap = 0
  let tax = 0

  for (const bracket of MISSOURI_BRACKETS) {
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

export function isMissouriWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  if (primaryState) {
    return primaryState === "Missouri"
  }

  return residenceState === "Missouri" || workState === "Missouri"
}

export function calculateMissouriWithholding(profile: {
  taxableIncome: number
  payFrequency: MissouriPayrollFrequency
  filingStatus: FilingStatus
  state?: string
  residenceState?: string
  workState?: string
  missouriSpouseDoesNotWork?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")

  if (primaryState !== "Missouri" && residenceState !== "Missouri" && workState !== "Missouri") {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualGrossIncome = d(profile.taxableIncome).mul(periods)
  const annualTaxableIncome = clampNonNegative(
    annualGrossIncome.sub(
      getMissouriStandardDeduction(profile.filingStatus, profile.missouriSpouseDoesNotWork)
    )
  )

  return d(calculateMissouriAnnualTax(annualTaxableIncome.toNumber()))
    .div(periods)
    .toDecimalPlaces(0)
    .toNumber()
}

export const missouriStrategy: StateTaxStrategy = {
  stateCode: "Missouri",
  applies: (context) => isMissouriWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (context.filingStatus === "marriedJoint" && context.profile.missouriSpouseDoesNotWork == null) {
      warnings.push(
        "Missouri Form MO W-4 uses a larger standard deduction only when the married employee checked the spouse-does-not-work box. Leave this off only if both spouses work."
      )
    }

    if (residenceState === "Missouri" && workState && workState !== "Missouri") {
      warnings.push(
        "Missouri residents working in another state can require a reduction for tax withheld to that other state. This calculator does not yet subtract another state's withholding from the Missouri payroll estimate."
      )
    }

    if (residenceState !== "Missouri" && workState === "Missouri") {
      warnings.push(
        "Missouri nonresident withholding is based on Missouri-source wages. If the employee works partly inside and partly outside Missouri for the same employer, a sourcing allocation may still be needed."
      )
    }

    return createStateCalculationResult("Missouri MO W-4 payroll withholding", "dedicated", {
      stateTax: calculateMissouriWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        filingStatus: context.filingStatus,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        missouriSpouseDoesNotWork: context.profile.missouriSpouseDoesNotWork,
      }),
      warnings,
    })
  },
}
