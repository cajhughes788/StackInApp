import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type ArkansasPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

const ARKANSAS_STANDARD_DEDUCTION = 2_470
const ARKANSAS_PERSONAL_CREDIT_PER_EXEMPTION = 29

function getPeriodsPerYear(freq: ArkansasPayrollFrequency): number {
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

function roundAnnualNetTaxableIncome(annualNetTaxableIncome: number): number {
  if (annualNetTaxableIncome <= 0) {
    return 0
  }

  if (annualNetTaxableIncome >= 100_001) {
    return annualNetTaxableIncome
  }

  return Math.floor(annualNetTaxableIncome / 100) * 100 + 50
}

function calculateAnnualGrossTax(annualNetTaxableIncome: number): number {
  if (annualNetTaxableIncome <= 5_600) {
    return 0
  }

  if (annualNetTaxableIncome <= 11_200) {
    return Math.round(annualNetTaxableIncome * 0.02 - 111.98)
  }

  if (annualNetTaxableIncome <= 16_000) {
    return Math.round(annualNetTaxableIncome * 0.03 - 223.97)
  }

  if (annualNetTaxableIncome <= 26_400) {
    return Math.round(annualNetTaxableIncome * 0.034 - 287.97)
  }

  if (annualNetTaxableIncome <= 94_700) {
    return Math.round(annualNetTaxableIncome * 0.039 - 419.96)
  }

  if (annualNetTaxableIncome <= 97_801) {
    const stepIndex = Math.floor((annualNetTaxableIncome - 94_701) / 100)
    const minusAdjustment = 399.3 - stepIndex * 10

    return Math.round(annualNetTaxableIncome * 0.039 - minusAdjustment)
  }

  return Math.round(annualNetTaxableIncome * 0.039 - 89.3)
}

function calculateLowIncomeCredit(
  annualWages: number,
  annualGrossTax: number,
  filingStatus: FilingStatus,
  exemptions: number
): number {
  let lowerThreshold = 0
  let upperThreshold = 0
  let maxCredit = 0

  if (filingStatus === "single") {
    lowerThreshold = 14_644
    upperThreshold = 17_500
    maxCredit = 111.8
  } else if (filingStatus === "headOfHousehold") {
    if (exemptions <= 1) {
      lowerThreshold = 20_821
      upperThreshold = 25_300
      maxCredit = 268.84
    } else {
      lowerThreshold = 24_819
      upperThreshold = 29_000
      maxCredit = 378.04
    }
  } else if (exemptions <= 1) {
    lowerThreshold = 24_696
    upperThreshold = 29_000
    maxCredit = 391.56
  } else {
    lowerThreshold = 29_723
    upperThreshold = 36_100
    maxCredit = 531.96
  }

  if (annualWages < lowerThreshold) {
    return annualGrossTax
  }

  const phaseoutRatio = 1 - (annualWages - lowerThreshold) / (upperThreshold - lowerThreshold)
  const calculatedCredit = phaseoutRatio * maxCredit

  return Math.max(0, Math.min(annualGrossTax, calculatedCredit))
}

export function isArkansasWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return primaryState === "Arkansas" || workState === "Arkansas"
}

export function calculateArkansasWithholding(profile: {
  taxableIncome: number
  filingStatus: FilingStatus
  payFrequency: ArkansasPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  arkansasExemptions?: number
  arkansasLowIncomeRates?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")

  if (primaryState !== "Arkansas" && workState !== "Arkansas") {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualWages = d(profile.taxableIncome).mul(periods).toNumber()
  const annualNetTaxableIncome = clampNonNegative(
    d(annualWages).sub(ARKANSAS_STANDARD_DEDUCTION)
  ).toNumber()
  const roundedAnnualNetTaxableIncome = roundAnnualNetTaxableIncome(annualNetTaxableIncome)
  const annualGrossTax = calculateAnnualGrossTax(roundedAnnualNetTaxableIncome)
  const exemptions = profile.arkansasExemptions ?? 0
  const lowIncomeCredit = profile.arkansasLowIncomeRates
    ? calculateLowIncomeCredit(annualWages, annualGrossTax, profile.filingStatus, exemptions)
    : 0
  const annualNetTax = Math.max(
    0,
    annualGrossTax
      - lowIncomeCredit
      - exemptions * ARKANSAS_PERSONAL_CREDIT_PER_EXEMPTION
  )

  return d(annualNetTax).div(periods).toDecimalPlaces(2).toNumber()
}

export const arkansasStrategy: StateTaxStrategy = {
  stateCode: "Arkansas",
  applies: (context) => isArkansasWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (residenceState === "Arkansas" && workState !== "Arkansas") {
      warnings.push(
        "Arkansas resident employees working entirely outside Arkansas generally are not subject to required Arkansas payroll withholding unless Arkansas is still chosen as the withholding state."
      )
    }

    warnings.push(
      "Texarkana border-city exemptions, military-spouse exemption certificates, and other special Arkansas exemption certificates are not separately modeled yet."
    )

    return createStateCalculationResult("Arkansas DFA 2026 withholding formula", "dedicated", {
      stateTax: calculateArkansasWithholding({
        taxableIncome: context.taxableIncome,
        filingStatus: context.filingStatus,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        arkansasExemptions: context.profile.arkansasExemptions,
        arkansasLowIncomeRates: context.profile.arkansasLowIncomeRates,
      }),
      warnings,
    })
  },
}
