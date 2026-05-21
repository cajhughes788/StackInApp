import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type CaliforniaPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

type CaliforniaMaritalBucket = "single" | "marriedLow" | "marriedHigh" | "headOfHousehold"

type CaliforniaBracket = {
  min: number
  max: number | null
  rate: number
  base: number
}

const CALIFORNIA_LOW_INCOME_EXEMPTION: Record<CaliforniaMaritalBucket, number> = {
  single: 18896,
  marriedLow: 18896,
  marriedHigh: 37791,
  headOfHousehold: 37791,
}

const CALIFORNIA_STANDARD_DEDUCTION: Record<CaliforniaMaritalBucket, number> = {
  single: 5706,
  marriedLow: 5706,
  marriedHigh: 11412,
  headOfHousehold: 11412,
}

const CALIFORNIA_EXEMPTION_CREDIT_PER_ALLOWANCE = 168.3

const CALIFORNIA_ANNUAL_BRACKETS: Record<CaliforniaMaritalBucket, CaliforniaBracket[]> = {
  single: [
    { min: 0, max: 11079, rate: 0.011, base: 0 },
    { min: 11079, max: 26264, rate: 0.022, base: 121.87 },
    { min: 26264, max: 41452, rate: 0.044, base: 455.94 },
    { min: 41452, max: 57542, rate: 0.066, base: 1124.21 },
    { min: 57542, max: 72724, rate: 0.088, base: 2186.15 },
    { min: 72724, max: 371479, rate: 0.1023, base: 3522.17 },
    { min: 371479, max: 445771, rate: 0.1133, base: 34084.81 },
    { min: 445771, max: 742953, rate: 0.1243, base: 42502.09 },
    { min: 742953, max: 1000000, rate: 0.1353, base: 79441.81 },
    { min: 1000000, max: null, rate: 0.1463, base: 114220.27 },
  ],
  marriedLow: [
    { min: 0, max: 11079, rate: 0.011, base: 0 },
    { min: 11079, max: 26264, rate: 0.022, base: 121.87 },
    { min: 26264, max: 41452, rate: 0.044, base: 455.94 },
    { min: 41452, max: 57542, rate: 0.066, base: 1124.21 },
    { min: 57542, max: 72724, rate: 0.088, base: 2186.15 },
    { min: 72724, max: 371479, rate: 0.1023, base: 3522.17 },
    { min: 371479, max: 445771, rate: 0.1133, base: 34084.81 },
    { min: 445771, max: 742953, rate: 0.1243, base: 42502.09 },
    { min: 742953, max: 1000000, rate: 0.1353, base: 79441.81 },
    { min: 1000000, max: null, rate: 0.1463, base: 114220.27 },
  ],
  marriedHigh: [
    { min: 0, max: 22158, rate: 0.011, base: 0 },
    { min: 22158, max: 52528, rate: 0.022, base: 243.74 },
    { min: 52528, max: 82904, rate: 0.044, base: 911.88 },
    { min: 82904, max: 115084, rate: 0.066, base: 2248.42 },
    { min: 115084, max: 145448, rate: 0.088, base: 4372.3 },
    { min: 145448, max: 742958, rate: 0.1023, base: 7044.33 },
    { min: 742958, max: 891542, rate: 0.1133, base: 68169.6 },
    { min: 891542, max: 1000000, rate: 0.1243, base: 85004.17 },
    { min: 1000000, max: 1485906, rate: 0.1353, base: 98485.5 },
    { min: 1485906, max: null, rate: 0.1463, base: 164228.58 },
  ],
  headOfHousehold: [
    { min: 0, max: 22173, rate: 0.011, base: 0 },
    { min: 22173, max: 52530, rate: 0.022, base: 243.9 },
    { min: 52530, max: 67716, rate: 0.044, base: 911.75 },
    { min: 67716, max: 83805, rate: 0.066, base: 1579.93 },
    { min: 83805, max: 98990, rate: 0.088, base: 2641.8 },
    { min: 98990, max: 505208, rate: 0.1023, base: 3978.08 },
    { min: 505208, max: 606251, rate: 0.1133, base: 45534.18 },
    { min: 606251, max: 1000000, rate: 0.1243, base: 56982.35 },
    { min: 1000000, max: 1010417, rate: 0.1353, base: 105925.35 },
    { min: 1010417, max: null, rate: 0.1463, base: 107334.77 },
  ],
}

function getPeriodsPerYear(freq: CaliforniaPayrollFrequency): number {
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

function getCaliforniaMaritalBucket(
  filingStatus: FilingStatus,
  totalAllowances: number
): CaliforniaMaritalBucket {
  switch (filingStatus) {
    case "marriedJoint":
      return totalAllowances >= 2 ? "marriedHigh" : "marriedLow"
    case "headOfHousehold":
      return "headOfHousehold"
    case "single":
    case "marriedSeparate":
      return "single"
  }
}

function getCaliforniaBracket(
  taxableIncome: number,
  filingStatus: FilingStatus,
  totalAllowances: number
): CaliforniaBracket {
  const maritalBucket = getCaliforniaMaritalBucket(filingStatus, totalAllowances)
  return (
    CALIFORNIA_ANNUAL_BRACKETS[maritalBucket].find(
      (bracket) => taxableIncome >= bracket.min && (bracket.max == null || taxableIncome < bracket.max)
    ) ?? CALIFORNIA_ANNUAL_BRACKETS[maritalBucket][CALIFORNIA_ANNUAL_BRACKETS[maritalBucket].length - 1]
  )
}

export function isCaliforniaWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const state = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    state === "California" ||
    residenceState === "California" ||
    workState === "California"
  )
}

export function calculateCaliforniaWithholding(profile: {
  taxableIncome: number
  filingStatus: FilingStatus
  payFrequency: CaliforniaPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  multiStateWorker?: boolean
  californiaRegularAllowances?: number
  californiaEstimatedDeductionAllowances?: number
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isCaliforniaResident = residenceState === "California"
  const worksInCalifornia = workState === "California"

  if (!isCaliforniaResident && !worksInCalifornia && primaryState !== "California") {
    return 0
  }

  const regularAllowances = profile.californiaRegularAllowances ?? 0
  const estimatedDeductionAllowances = profile.californiaEstimatedDeductionAllowances ?? 0
  const totalAllowances = regularAllowances + estimatedDeductionAllowances
  const maritalBucket = getCaliforniaMaritalBucket(profile.filingStatus, totalAllowances)
  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualWages = d(profile.taxableIncome).mul(periods)
  const annualEstimatedDeduction = d(estimatedDeductionAllowances).mul(1000)
  const annualTaxableIncome = clampNonNegative(
    annualWages
      .sub(annualEstimatedDeduction)
      .sub(CALIFORNIA_STANDARD_DEDUCTION[maritalBucket])
  )

  if (annualWages.lte(CALIFORNIA_LOW_INCOME_EXEMPTION[maritalBucket])) {
    return 0
  }

  const bracket = getCaliforniaBracket(
    annualTaxableIncome.toNumber(),
    profile.filingStatus,
    totalAllowances
  )
  const annualComputedTax = d(bracket.base).add(
    annualTaxableIncome.sub(bracket.min).mul(bracket.rate)
  )
  const annualExemptionCredit = d(regularAllowances).mul(
    CALIFORNIA_EXEMPTION_CREDIT_PER_ALLOWANCE
  )
  const annualWithholding = clampNonNegative(annualComputedTax.sub(annualExemptionCredit))

  return annualWithholding.div(periods).toDecimalPlaces(2).toNumber()
}

export const californiaStrategy: StateTaxStrategy = {
  stateCode: "California",
  applies: (context) => isCaliforniaWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (residenceState === "California" && workState !== "California") {
      warnings.push(
        "California residents working in another taxing jurisdiction may need the other jurisdiction withholding offset applied manually; this calculator currently computes California PIT withholding only."
      )
    }

    if (
      residenceState !== "California" &&
      workState === "California" &&
      context.multiStateWorker
    ) {
      warnings.push(
        "California nonresident wages are fully treated as California-source wages here. If only part of the employee's services are performed in California, this estimate can over-withhold."
      )
    }

    if (
      context.filingStatus === "marriedJoint" &&
      (context.profile.californiaRegularAllowances ?? 0) < 2
    ) {
      warnings.push(
        "California uses the married 0-or-1 allowance table when a married employee claims fewer than two total allowances, which can withhold more aggressively than the married 2-or-more table."
      )
    }

    return createStateCalculationResult("California dedicated payroll withholding", "dedicated", {
      stateTax: calculateCaliforniaWithholding({
        taxableIncome: context.taxableIncome,
        filingStatus: context.filingStatus,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        multiStateWorker: context.multiStateWorker,
        californiaRegularAllowances: context.profile.californiaRegularAllowances,
        californiaEstimatedDeductionAllowances: context.profile.californiaEstimatedDeductionAllowances,
      }),
      warnings,
    })
  },
}
