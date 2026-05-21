import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type DelawarePayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

function getPeriodsPerYear(freq: DelawarePayrollFrequency): number {
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

function getDelawareStandardDeduction(filingStatus: FilingStatus): number {
  switch (filingStatus) {
    case "marriedJoint":
      return 6_500
    case "single":
    case "marriedSeparate":
    case "headOfHousehold":
      return 3_250
  }
}

function calculateDelawareAnnualTax(annualTaxableIncome: number): number {
  if (annualTaxableIncome <= 2_000) return 0
  if (annualTaxableIncome <= 5_000) return (annualTaxableIncome - 2_000) * 0.022
  if (annualTaxableIncome <= 10_000) return 66 + (annualTaxableIncome - 5_000) * 0.039
  if (annualTaxableIncome <= 20_000) return 261 + (annualTaxableIncome - 10_000) * 0.048
  if (annualTaxableIncome <= 25_000) return 741 + (annualTaxableIncome - 20_000) * 0.052
  if (annualTaxableIncome <= 60_000) return 1_001 + (annualTaxableIncome - 25_000) * 0.0555

  return 2_943.5 + (annualTaxableIncome - 60_000) * 0.066
}

export function isDelawareWithholdingState(profile: {
  state?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return primaryState === "Delaware" || workState === "Delaware"
}

export function calculateDelawareWithholding(profile: {
  taxableIncome: number
  filingStatus: FilingStatus
  payFrequency: DelawarePayrollFrequency
  state?: string
  workState?: string
  delawareWithholdingExemptions?: number
  stateWithholdingExemptions?: number
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")

  if (primaryState !== "Delaware" && workState !== "Delaware") {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualWages = d(profile.taxableIncome).mul(periods)
  const annualTaxableIncome = clampNonNegative(
    annualWages.sub(getDelawareStandardDeduction(profile.filingStatus))
  ).toNumber()
  const annualTax = Math.max(
    0,
    calculateDelawareAnnualTax(annualTaxableIncome)
      - (profile.delawareWithholdingExemptions ?? profile.stateWithholdingExemptions ?? 0) * 110
  )

  return d(annualTax).div(periods).toDecimalPlaces(2).toNumber()
}

export const delawareStrategy: StateTaxStrategy = {
  stateCode: "Delaware",
  applies: (context) => isDelawareWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (context.filingStatus === "headOfHousehold") {
      warnings.push(
        "Delaware's payroll guide publishes single, married-joint, and married-separate annualized withholding formulas. This calculator uses the single withholding schedule for head-of-household wages."
      )
    }

    if (residenceState !== "Delaware" && workState === "Delaware") {
      warnings.push(
        "Delaware nonresident withholding can require a Delaware W-4NR when only part of the employee's annual wages are Delaware-source wages, and that allocation is not tracked yet."
      )
    }

    if (residenceState === "Delaware" && workState !== "Delaware") {
      warnings.push(
        "Delaware does not have wage-tax reciprocity with other states. Delaware residents working outside Delaware may still owe Delaware tax, but payroll withholding is generally controlled by the work state."
      )
    }

    return createStateCalculationResult("Delaware annualized withholding formula", "dedicated", {
      stateTax: calculateDelawareWithholding({
        taxableIncome: context.taxableIncome,
        filingStatus: context.filingStatus,
        payFrequency: context.payFrequency,
        state: context.state,
        workState: context.workState,
        delawareWithholdingExemptions: context.profile.delawareWithholdingExemptions,
        stateWithholdingExemptions: context.profile.stateWithholdingExemptions,
      }),
      warnings,
    })
  },
}
