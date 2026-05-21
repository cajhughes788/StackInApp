import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { StateTaxStrategy, TaxProfileInput } from "../types"

type SouthCarolinaPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

function getPeriodsPerYear(freq: SouthCarolinaPayrollFrequency): number {
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

function calculateSouthCarolinaAnnualTax(annualTaxableIncome: number): number {
  if (annualTaxableIncome < 3_640) {
    return 0
  }

  if (annualTaxableIncome < 18_230) {
    return annualTaxableIncome * 0.03 - 109.2
  }

  return annualTaxableIncome * 0.06 - 656.1
}

export function isSouthCarolinaWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    primaryState === "SouthCarolina" ||
    residenceState === "SouthCarolina" ||
    workState === "SouthCarolina"
  )
}

export function calculateSouthCarolinaWithholding(profile: {
  taxableIncome: number
  payFrequency: SouthCarolinaPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  southCarolinaWithholdingExemptions?: number
  stateWithholdingExemptions?: number
  southCarolinaExempt?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")

  if (
    primaryState !== "SouthCarolina" &&
    residenceState !== "SouthCarolina" &&
    workState !== "SouthCarolina"
  ) {
    return 0
  }

  if (profile.southCarolinaExempt) {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualWages = d(profile.taxableIncome).mul(periods).toNumber()
  const allowances =
    profile.southCarolinaWithholdingExemptions ?? profile.stateWithholdingExemptions ?? 0
  const standardDeduction = allowances > 0 ? Math.min(annualWages * 0.1, 7_500) : 0
  const annualTaxableIncome = clampNonNegative(
    d(annualWages).sub(allowances * 5_000).sub(standardDeduction)
  ).toNumber()
  const annualTax = calculateSouthCarolinaAnnualTax(annualTaxableIncome)

  return d(annualTax).div(periods).toDecimalPlaces(2).toNumber()
}

export const southCarolinaStrategy: StateTaxStrategy = {
  stateCode: "SouthCarolina",
  applies: (context) => isSouthCarolinaWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (residenceState !== "SouthCarolina" && workState === "SouthCarolina") {
      warnings.push(
        "South Carolina military-spouse withholding exemptions and other exempt-certificate scenarios are only applied here when the South Carolina exempt toggle is turned on."
      )
    }

    return createStateCalculationResult("South Carolina 2026 withholding formula", "dedicated", {
      stateTax: calculateSouthCarolinaWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        southCarolinaWithholdingExemptions:
          context.profile.southCarolinaWithholdingExemptions,
        stateWithholdingExemptions: context.profile.stateWithholdingExemptions,
        southCarolinaExempt: context.profile.southCarolinaExempt,
      }),
      warnings,
    })
  },
}
