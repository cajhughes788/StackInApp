import { calculateFederalTax } from "../federal"
import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type AlabamaPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

type AlabamaExemptionCode = NonNullable<TaxProfileInput["alabamaExemptionCode"]>

function getPeriodsPerYear(freq: AlabamaPayrollFrequency): number {
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

function getDefaultAlabamaExemptionCode(filingStatus: FilingStatus): AlabamaExemptionCode {
  switch (filingStatus) {
    case "marriedJoint":
      return "M"
    case "marriedSeparate":
      return "MS"
    case "headOfHousehold":
      return "H"
    case "single":
      return "S"
  }
}

function getAlabamaStandardDeduction(
  annualGrossIncome: number,
  exemptionCode: AlabamaExemptionCode
): number {
  if (exemptionCode === "0" || exemptionCode === "S") {
    if (annualGrossIncome <= 25_999) return 3_000
    if (annualGrossIncome >= 35_500) return 2_500
    return 3_000 - Math.ceil((annualGrossIncome - 25_999) / 500) * 25
  }

  if (exemptionCode === "MS") {
    if (annualGrossIncome <= 12_999) return 4_250
    if (annualGrossIncome >= 17_750) return 2_500
    return 4_250 - Math.ceil((annualGrossIncome - 12_999) / 250) * 88
  }

  if (exemptionCode === "M") {
    if (annualGrossIncome <= 25_999) return 8_500
    if (annualGrossIncome >= 35_500) return 5_000
    return 8_500 - Math.ceil((annualGrossIncome - 25_999) / 500) * 175
  }

  if (annualGrossIncome <= 25_999) return 5_200
  if (annualGrossIncome >= 35_500) return 2_500
  return 5_200 - Math.ceil((annualGrossIncome - 25_999) / 500) * 135
}

function getAlabamaPersonalExemption(exemptionCode: AlabamaExemptionCode): number {
  switch (exemptionCode) {
    case "0":
      return 0
    case "S":
    case "MS":
      return 1_500
    case "M":
    case "H":
      return 3_000
  }
}

function getAlabamaDependentExemption(annualGrossIncome: number): number {
  if (annualGrossIncome <= 50_000) return 1_000
  if (annualGrossIncome <= 100_000) return 500
  return 300
}

function calculateAlabamaAnnualTax(
  annualTaxableIncome: number,
  exemptionCode: AlabamaExemptionCode
): number {
  if (annualTaxableIncome <= 0) {
    return 0
  }

  const firstBracketCap = exemptionCode === "M" ? 1_000 : 500
  const secondBracketCap = exemptionCode === "M" ? 6_000 : 3_000

  if (annualTaxableIncome <= firstBracketCap) {
    return annualTaxableIncome * 0.02
  }

  if (annualTaxableIncome <= secondBracketCap) {
    return firstBracketCap * 0.02 + (annualTaxableIncome - firstBracketCap) * 0.04
  }

  return (
    firstBracketCap * 0.02 +
    (secondBracketCap - firstBracketCap) * 0.04 +
    (annualTaxableIncome - secondBracketCap) * 0.05
  )
}

export function isAlabamaWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  if (primaryState) {
    return primaryState === "Alabama"
  }

  return residenceState === "Alabama" || workState === "Alabama"
}

export function calculateAlabamaWithholding(profile: {
  taxableIncome: number
  payFrequency: AlabamaPayrollFrequency
  filingStatus: FilingStatus
  dependents?: number
  federalMultipleJobsCheckbox?: boolean
  federalStep3Credits?: number
  federalOtherIncome?: number
  federalDeductions?: number
  federalExempt?: boolean
  state?: string
  residenceState?: string
  workState?: string
  alabamaExemptionCode?: AlabamaExemptionCode
  additionalFederalWithholding?: number
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isAlabamaResident = residenceState === "Alabama"
  const worksInAlabama = workState === "Alabama"

  if (!isAlabamaResident && !worksInAlabama && primaryState !== "Alabama") {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualGrossIncome = d(profile.taxableIncome).mul(periods)
  const exemptionCode =
    profile.alabamaExemptionCode ?? getDefaultAlabamaExemptionCode(profile.filingStatus)
  const federalWithholdingPerPeriod =
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
  const annualFederalWithholding = d(federalWithholdingPerPeriod).mul(periods)
  const dependentExemption = getAlabamaDependentExemption(annualGrossIncome.toNumber())
  const annualTaxableIncome = clampNonNegative(
    annualGrossIncome
      .sub(getAlabamaStandardDeduction(annualGrossIncome.toNumber(), exemptionCode))
      .sub(getAlabamaPersonalExemption(exemptionCode))
      .sub(d(profile.dependents ?? 0).mul(dependentExemption))
      .sub(annualFederalWithholding)
  )

  return d(calculateAlabamaAnnualTax(annualTaxableIncome.toNumber(), exemptionCode))
    .div(periods)
    .toDecimalPlaces(2)
    .toNumber()
}

export const alabamaStrategy: StateTaxStrategy = {
  stateCode: "Alabama",
  applies: (context) => isAlabamaWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (
      residenceState !== "Alabama" &&
      workState === "Alabama" &&
      context.multiStateWorker
    ) {
      warnings.push(
        "Alabama's 30-day safe harbor for certain out-of-state workers is not modeled because the calculator does not yet track Alabama workdays by calendar year."
      )
    }

    if (
      residenceState === "Alabama" &&
      workState !== "Alabama"
    ) {
      warnings.push(
        "Alabama resident employees working in another income-tax state may not need separate Alabama withholding when the employer is already withholding to the work state."
      )
    }

    return createStateCalculationResult("Alabama Form A-4 payroll withholding", "dedicated", {
      stateTax: calculateAlabamaWithholding({
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
        alabamaExemptionCode: context.profile.alabamaExemptionCode,
        additionalFederalWithholding: context.profile.additionalFederalWithholding,
      }),
      warnings,
    })
  },
}
