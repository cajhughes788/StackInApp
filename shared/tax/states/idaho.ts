import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type IdahoPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

const IDAHO_ALLOWANCE_VALUES: Record<IdahoPayrollFrequency, number> = {
  weekly: 74.38,
  biweekly: 148.77,
  "semi-monthly": 161.16,
  monthly: 322.33,
  annual: 3_868,
}

function getPeriodsPerYear(freq: IdahoPayrollFrequency): number {
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

function isIdahoSingleRate(filingStatus: FilingStatus): boolean {
  return filingStatus !== "marriedJoint"
}

export function isIdahoWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  if (primaryState) {
    return primaryState === "Idaho"
  }

  return residenceState === "Idaho" || workState === "Idaho"
}

export function calculateIdahoWithholding(profile: {
  taxableIncome: number
  payFrequency: IdahoPayrollFrequency
  filingStatus: FilingStatus
  state?: string
  residenceState?: string
  workState?: string
  idahoAllowances?: number
  idahoAdditionalWithholding?: number
  idahoExempt?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isIdahoResident = residenceState === "Idaho"
  const worksInIdaho = workState === "Idaho"

  if (profile.idahoExempt) {
    return 0
  }

  if (!isIdahoResident && !worksInIdaho && primaryState !== "Idaho") {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualGrossIncome = d(profile.taxableIncome).mul(periods)

  if (!isIdahoResident && worksInIdaho && annualGrossIncome.lt(1_000)) {
    return 0
  }

  const annualTaxableWages = clampNonNegative(
    annualGrossIncome.sub(
      d(IDAHO_ALLOWANCE_VALUES.annual).mul(profile.idahoAllowances ?? 0)
    )
  )
  const threshold = isIdahoSingleRate(profile.filingStatus) ? 15_000 : 30_000
  const annualWithholding = annualTaxableWages.lte(threshold)
    ? d(0)
    : annualTaxableWages.sub(threshold).mul(0.053)
  const perPeriodWithholding = annualWithholding.div(periods)

  return Math.max(0, Math.round(perPeriodWithholding.toNumber() + (profile.idahoAdditionalWithholding ?? 0)))
}

export const idahoStrategy: StateTaxStrategy = {
  stateCode: "Idaho",
  applies: (context) => isIdahoWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (
      residenceState === "Idaho" &&
      workState !== "Idaho"
    ) {
      warnings.push(
        "Idaho withholding for an Idaho resident working entirely in another state is generally voluntary and depends on whether the employer elected to continue Idaho withholding."
      )
    }

    if (
      residenceState !== "Idaho" &&
      workState === "Idaho"
    ) {
      warnings.push(
        "Idaho nonresident withholding is not required until Idaho wages exceed $1,000 for the calendar year. This calculator annualizes the current paycheck to test that threshold."
      )
    }

    return createStateCalculationResult("Idaho Form ID W-4 payroll withholding", "dedicated", {
      stateTax: calculateIdahoWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        filingStatus: context.filingStatus,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        idahoAllowances: context.profile.idahoAllowances,
        idahoAdditionalWithholding: context.profile.idahoAdditionalWithholding,
        idahoExempt: context.profile.idahoExempt,
      }),
      warnings,
    })
  },
}
