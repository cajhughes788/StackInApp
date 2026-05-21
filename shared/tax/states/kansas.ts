import { d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type KansasPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

type KansasAllowanceRate = NonNullable<TaxProfileInput["kansasAllowanceRate"]>

function getPeriodsPerYear(freq: KansasPayrollFrequency): number {
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

function getDefaultKansasAllowanceRate(filingStatus: FilingStatus): KansasAllowanceRate {
  return filingStatus === "marriedJoint" ? "joint" : "single"
}

function getKansasAnnualAllowance(
  allowanceRate: KansasAllowanceRate,
  filingStatus: FilingStatus,
  dependents: number
): number {
  const baseAllowance = allowanceRate === "joint" ? 18_320 : 9_160
  const headOfHouseholdAllowance = filingStatus === "headOfHousehold" ? 2_320 : 0
  const dependentAllowance = dependents * 2_320

  return baseAllowance + headOfHouseholdAllowance + dependentAllowance
}

function calculateKansasAnnualTax(
  annualTaxableWages: number,
  allowanceRate: KansasAllowanceRate
): number {
  if (allowanceRate === "joint") {
    if (annualTaxableWages <= 8_240) return 0
    if (annualTaxableWages <= 54_240) {
      return (annualTaxableWages - 8_240) * 0.052
    }
    return 2_392 + (annualTaxableWages - 54_240) * 0.0558
  }

  if (annualTaxableWages <= 3_605) return 0
  if (annualTaxableWages <= 26_605) {
    return (annualTaxableWages - 3_605) * 0.052
  }
  return 1_196 + (annualTaxableWages - 26_605) * 0.0558
}

export function isKansasWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  if (primaryState) {
    return primaryState === "Kansas"
  }

  return residenceState === "Kansas" || workState === "Kansas"
}

export function calculateKansasWithholding(profile: {
  taxableIncome: number
  payFrequency: KansasPayrollFrequency
  filingStatus: FilingStatus
  dependents?: number
  state?: string
  residenceState?: string
  workState?: string
  kansasAllowanceRate?: KansasAllowanceRate
  kansasAdditionalWithholding?: number
  kansasExempt?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isKansasResident = residenceState === "Kansas"
  const worksInKansas = workState === "Kansas"

  if (profile.kansasExempt) {
    return 0
  }

  if (!isKansasResident && !worksInKansas && primaryState !== "Kansas") {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const allowanceRate =
    profile.kansasAllowanceRate ?? getDefaultKansasAllowanceRate(profile.filingStatus)
  const annualTaxableWages = Math.max(
    0,
    d(profile.taxableIncome)
      .mul(periods)
      .sub(
        getKansasAnnualAllowance(
          allowanceRate,
          profile.filingStatus,
          profile.dependents ?? 0
        )
      )
      .toNumber()
  )
  const annualWithholding = calculateKansasAnnualTax(annualTaxableWages, allowanceRate)
  const perPeriodWithholding = annualWithholding / periods + (profile.kansasAdditionalWithholding ?? 0)

  return Math.max(0, Math.round(perPeriodWithholding))
}

export const kansasStrategy: StateTaxStrategy = {
  stateCode: "Kansas",
  applies: (context) => isKansasWithholdingState(context),
  calculate: (context) => {
    const warnings: string[] = []

    if (
      context.filingStatus === "marriedJoint" &&
      context.profile.kansasAllowanceRate == null
    ) {
      warnings.push(
        "Kansas withholding can differ depending on whether a married employee selected the Single or Joint allowance rate on Form K-4. This estimate defaults married-joint filers to the Joint rate unless you override it."
      )
    }

    return createStateCalculationResult("Kansas Form K-4 payroll withholding", "dedicated", {
      stateTax: calculateKansasWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        filingStatus: context.filingStatus,
        dependents: context.dependents,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        kansasAllowanceRate: context.profile.kansasAllowanceRate,
        kansasAdditionalWithholding: context.profile.kansasAdditionalWithholding,
        kansasExempt: context.profile.kansasExempt,
      }),
      warnings,
    })
  },
}
