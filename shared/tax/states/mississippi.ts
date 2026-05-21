import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type MississippiPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

const MISSISSIPPI_STANDARD_DEDUCTION: Record<FilingStatus, number> = {
  single: 2_300,
  marriedJoint: 4_600,
  marriedSeparate: 2_300,
  headOfHousehold: 3_400,
}

const MISSISSIPPI_BASE_EXEMPTION: Record<FilingStatus, number> = {
  single: 6_000,
  marriedJoint: 12_000,
  marriedSeparate: 6_000,
  headOfHousehold: 8_000,
}

const MISSISSIPPI_DEPENDENT_EXEMPTION = 1_500
const MISSISSIPPI_ZERO_RATE_THRESHOLD = 10_000
const MISSISSIPPI_RATE = 0.04

function getPeriodsPerYear(freq: MississippiPayrollFrequency): number {
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

function getDefaultMississippiExemptionAmount(
  filingStatus: FilingStatus,
  dependents: number
): number {
  return MISSISSIPPI_BASE_EXEMPTION[filingStatus] + dependents * MISSISSIPPI_DEPENDENT_EXEMPTION
}

export function isMississippiWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  if (primaryState) {
    return primaryState === "Mississippi"
  }

  return residenceState === "Mississippi" || workState === "Mississippi"
}

export function calculateMississippiWithholding(profile: {
  taxableIncome: number
  payFrequency: MississippiPayrollFrequency
  filingStatus: FilingStatus
  dependents: number
  state?: string
  residenceState?: string
  workState?: string
  mississippiExemptionAmount?: number
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")

  if (primaryState !== "Mississippi" && residenceState !== "Mississippi" && workState !== "Mississippi") {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualGrossIncome = d(profile.taxableIncome).mul(periods)
  const annualTaxableIncome = clampNonNegative(
    annualGrossIncome
      .sub(MISSISSIPPI_STANDARD_DEDUCTION[profile.filingStatus])
      .sub(
        profile.mississippiExemptionAmount ??
          getDefaultMississippiExemptionAmount(profile.filingStatus, profile.dependents)
      )
  )
  const annualWithholding = clampNonNegative(annualTaxableIncome.sub(MISSISSIPPI_ZERO_RATE_THRESHOLD))
    .mul(MISSISSIPPI_RATE)

  return annualWithholding.div(periods).toDecimalPlaces(0).toNumber()
}

export const mississippiStrategy: StateTaxStrategy = {
  stateCode: "Mississippi",
  applies: (context) => isMississippiWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (
      context.profile.mississippiExemptionAmount == null &&
      context.filingStatus === "marriedJoint" &&
      context.profile.mississippiSpouseEmployed
    ) {
      warnings.push(
        "For a married employee with both spouses working, Mississippi Form 89-350 often splits the exemption amount between the two jobs. Enter the exact Mississippi exemption amount on file for the most accurate withholding."
      )
    }

    if (
      context.profile.mississippiExemptionAmount == null &&
      context.dependents > 0
    ) {
      warnings.push(
        "This Mississippi estimate derives the exemption amount from filing status and dependents. Enter the exact Form 89-350 exemption amount if the employee also claims age, blindness, or a custom split between spouses."
      )
    }

    if (residenceState === "Mississippi" && workState && workState !== "Mississippi") {
      warnings.push(
        "Mississippi resident employees working outside Mississippi may need resident return credits or sourcing adjustments that are not fully modeled in payroll withholding here."
      )
    }

    return createStateCalculationResult("Mississippi Form 89-350 payroll withholding", "dedicated", {
      stateTax: calculateMississippiWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        filingStatus: context.filingStatus,
        dependents: context.dependents,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        mississippiExemptionAmount: context.profile.mississippiExemptionAmount,
      }),
      warnings,
    })
  },
}
