import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type MainePayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

function getPeriodsPerYear(freq: MainePayrollFrequency): number {
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

function useMaineSingleRate(
  filingStatus: FilingStatus,
  maineHigherSingleRate?: boolean
): boolean {
  return filingStatus !== "marriedJoint" || Boolean(maineHigherSingleRate)
}

function getMaineStandardDeduction(annualizedWages: number, singleRate: boolean): number {
  if (singleRate) {
    if (annualizedWages <= 102_250) return 12_450
    if (annualizedWages >= 177_250) return 0

    return (12_450 * (177_250 - annualizedWages)) / 75_000
  }

  if (annualizedWages <= 204_550) return 27_750
  if (annualizedWages >= 354_550) return 0

  return (27_750 * (354_550 - annualizedWages)) / 150_000
}

function calculateMaineAnnualTax(annualizedIncome: number, singleRate: boolean): number {
  if (singleRate) {
    if (annualizedIncome < 27_400) {
      return annualizedIncome * 0.058
    }

    if (annualizedIncome < 64_850) {
      return 1_589 + (annualizedIncome - 27_400) * 0.0675
    }

    return 4_117 + (annualizedIncome - 64_850) * 0.0715
  }

  if (annualizedIncome < 54_850) {
    return annualizedIncome * 0.058
  }

  if (annualizedIncome < 129_750) {
    return 3_181 + (annualizedIncome - 54_850) * 0.0675
  }

  return 8_237 + (annualizedIncome - 129_750) * 0.0715
}

export function isMaineWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return primaryState === "Maine" || residenceState === "Maine" || workState === "Maine"
}

export function calculateMaineWithholding(profile: {
  taxableIncome: number
  filingStatus: FilingStatus
  payFrequency: MainePayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  maineWithholdingExemptions?: number
  stateWithholdingExemptions?: number
  maineHigherSingleRate?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")

  if (
    primaryState !== "Maine" &&
    residenceState !== "Maine" &&
    workState !== "Maine"
  ) {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualizedWages = d(profile.taxableIncome).mul(periods).toNumber()
  const singleRate = useMaineSingleRate(profile.filingStatus, profile.maineHigherSingleRate)
  const allowanceCount =
    profile.maineWithholdingExemptions ?? profile.stateWithholdingExemptions ?? 0
  const annualizedIncome = clampNonNegative(
    d(annualizedWages)
      .sub(d(allowanceCount).mul(5_300))
      .sub(getMaineStandardDeduction(annualizedWages, singleRate))
  ).toNumber()
  const annualTax = calculateMaineAnnualTax(annualizedIncome, singleRate)

  return Math.round(annualTax / periods)
}

export const maineStrategy: StateTaxStrategy = {
  stateCode: "Maine",
  applies: (context) => isMaineWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (residenceState !== "Maine" && workState === "Maine") {
      warnings.push(
        "Maine nonresident withholding can depend on whether the employee exceeds Maine's 12-day and $3,000 annual work threshold, which this calculator does not track yet."
      )
    }

    return createStateCalculationResult("Maine 2026 percentage-method payroll withholding", "dedicated", {
      stateTax: calculateMaineWithholding({
        taxableIncome: context.taxableIncome,
        filingStatus: context.filingStatus,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        maineWithholdingExemptions: context.profile.maineWithholdingExemptions,
        stateWithholdingExemptions: context.profile.stateWithholdingExemptions,
        maineHigherSingleRate: context.profile.maineHigherSingleRate,
      }),
      warnings,
    })
  },
}
