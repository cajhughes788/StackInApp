import { calculateFederalTax } from "../federal"
import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type OregonPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

type OregonGroup = "single" | "married"

const OREGON_ALLOWANCE_VALUE = 263
const OREGON_STANDARD_DEDUCTION = {
  single: 2_910,
  married: 5_820,
} as const satisfies Record<OregonGroup, number>

function getPeriodsPerYear(freq: OregonPayrollFrequency): number {
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

function isOregonWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")

  return (
    primaryState === "Oregon" ||
    residenceState === "Oregon" ||
    workState === "Oregon"
  )
}

function getOregonGroup(
  filingStatus: FilingStatus,
  allowances: number,
  higherSingleRate: boolean
): OregonGroup {
  if (filingStatus === "marriedJoint" && !higherSingleRate) {
    return "married"
  }

  return allowances >= 3 ? "married" : "single"
}

function getFederalSubtractionCap(group: OregonGroup, annualWages: number): number {
  if (group === "single") {
    if (annualWages < 125_000) return 8_750
    if (annualWages < 130_000) return 7_000
    if (annualWages < 135_000) return 5_250
    if (annualWages < 140_000) return 3_500
    if (annualWages < 145_000) return 1_750
    return 0
  }

  if (annualWages < 250_000) return 8_750
  if (annualWages < 260_000) return 7_000
  if (annualWages < 270_000) return 5_250
  if (annualWages < 280_000) return 3_500
  if (annualWages < 290_000) return 1_750
  return 0
}

function getAllowedAllowances(
  group: OregonGroup,
  annualWages: number,
  allowances: number,
  filingStatus: FilingStatus
): number {
  if (group === "single" && annualWages > 100_000) {
    return 0
  }

  if (group === "married" && filingStatus === "marriedJoint" && annualWages > 200_000) {
    return 0
  }

  if (group === "married" && filingStatus !== "marriedJoint" && annualWages > 100_000) {
    return 0
  }

  return allowances
}

function calculateOregonAnnualTax(base: number, group: OregonGroup, allowances: number): number {
  if (group === "single") {
    if (base <= 4_550) {
      return 263 + base * 0.0475 - OREGON_ALLOWANCE_VALUE * allowances
    }

    if (base <= 11_400) {
      return 479 + (base - 4_550) * 0.0675 - OREGON_ALLOWANCE_VALUE * allowances
    }

    if (base <= 125_000) {
      return 941 + (base - 11_400) * 0.0875 - OREGON_ALLOWANCE_VALUE * allowances
    }

    return 10_618 + (base - 125_000) * 0.099 - OREGON_ALLOWANCE_VALUE * allowances
  }

  if (base <= 9_100) {
    return 263 + base * 0.0475 - OREGON_ALLOWANCE_VALUE * allowances
  }

  if (base <= 22_800) {
    return 695 + (base - 9_100) * 0.0675 - OREGON_ALLOWANCE_VALUE * allowances
  }

  if (base <= 250_000) {
    return 1_620 + (base - 22_800) * 0.0875 - OREGON_ALLOWANCE_VALUE * allowances
  }

  return 21_237 + (base - 250_000) * 0.099 - OREGON_ALLOWANCE_VALUE * allowances
}

function calculateOregonWithholding(profile: {
  taxableIncome: number
  payFrequency: OregonPayrollFrequency
  filingStatus: FilingStatus
  dependents: number
  federalMultipleJobsCheckbox?: boolean
  federalStep3Credits?: number
  federalOtherIncome?: number
  federalDeductions?: number
  federalExempt?: boolean
  additionalFederalWithholding?: number
  state?: string
  residenceState?: string
  workState?: string
  oregonAllowances?: number
  oregonAdditionalWithholding?: number
  oregonHigherSingleRate?: boolean
  oregonExempt?: boolean
}): number {
  if (!isOregonWithholdingState(profile) || profile.oregonExempt) {
    return 0
  }

  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  if (residenceState !== "Oregon" && workState !== "Oregon") {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualWages = d(profile.taxableIncome).mul(periods).toNumber()
  const requestedAllowances = profile.oregonAllowances ?? 0
  const higherSingleRate = profile.oregonHigherSingleRate ?? false
  const group = getOregonGroup(profile.filingStatus, requestedAllowances, higherSingleRate)
  const allowedAllowances = getAllowedAllowances(
    group,
    annualWages,
    requestedAllowances,
    profile.filingStatus
  )
  const annualFederalWithholding = d(
    calculateFederalTax({
      grossIncome: profile.taxableIncome,
      payFrequency: profile.payFrequency,
      filingStatus: profile.filingStatus,
      dependents: profile.dependents,
      federalMultipleJobsCheckbox: profile.federalMultipleJobsCheckbox,
      federalStep3Credits: profile.federalStep3Credits,
      federalOtherIncome: profile.federalOtherIncome,
      federalDeductions: profile.federalDeductions,
      federalExempt: profile.federalExempt,
      additionalFederalWithholding: profile.additionalFederalWithholding,
    })
  )
    .mul(periods)
    .toNumber()
  const cappedFederalWithholding = Math.min(
    annualFederalWithholding,
    getFederalSubtractionCap(group, annualWages)
  )
  const base = clampNonNegative(
    d(annualWages)
      .sub(cappedFederalWithholding)
      .sub(OREGON_STANDARD_DEDUCTION[group])
  ).toNumber()
  const annualTax = clampNonNegative(
    d(calculateOregonAnnualTax(base, group, allowedAllowances))
  )

  return annualTax
    .div(periods)
    .add(profile.oregonAdditionalWithholding ?? 0)
    .toDecimalPlaces(2)
    .toNumber()
}

export const oregonStrategy: StateTaxStrategy = {
  stateCode: "Oregon",
  applies: (context) => isOregonWithholdingState(context),
  calculate: (context) => {
    const warnings: string[] = []
    const annualWages = d(context.taxableIncome).mul(getPeriodsPerYear(context.payFrequency)).toNumber()

    if ((context.profile.oregonAllowances ?? 0) === 0) {
      warnings.push(
        "Oregon withholding is using zero OR-W-4 allowances unless an Oregon allowance count is entered."
      )
    }

    if (context.profile.oregonHigherSingleRate && context.filingStatus !== "marriedJoint") {
      warnings.push(
        "The Oregon higher single-rate toggle is only meaningful for married employees and is ignored for non-joint filing statuses."
      )
    }

    if (annualWages >= 100_000 && context.profile.oregonAllowances) {
      warnings.push(
        "Oregon zeroes out allowances for high-income payroll withholding in some cases, so the entered OR-W-4 allowance count may not reduce withholding at this wage level."
      )
    }

    return createStateCalculationResult("Oregon OR-W-4 annual payroll formula", "dedicated", {
      stateTax: calculateOregonWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        filingStatus: context.filingStatus,
        dependents: context.dependents,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        federalMultipleJobsCheckbox: context.profile.federalMultipleJobsCheckbox,
        federalStep3Credits: context.profile.federalStep3Credits,
        federalOtherIncome: context.profile.federalOtherIncome,
        federalDeductions: context.profile.federalDeductions,
        federalExempt: context.profile.federalExempt,
        additionalFederalWithholding: context.profile.additionalFederalWithholding,
        oregonAllowances: context.profile.oregonAllowances,
        oregonAdditionalWithholding: context.profile.oregonAdditionalWithholding,
        oregonHigherSingleRate: context.profile.oregonHigherSingleRate,
        oregonExempt: context.profile.oregonExempt,
      }),
      warnings,
    })
  },
}
