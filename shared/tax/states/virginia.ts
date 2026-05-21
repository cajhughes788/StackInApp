import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type VirginiaPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

const VIRGINIA_SINGLE_STANDARD_DEDUCTION = 8750
const VIRGINIA_MARRIED_JOINT_STANDARD_DEDUCTION = 17500
const VIRGINIA_PERSONAL_EXEMPTION_VALUE = 930
const VIRGINIA_AGE_BLIND_EXEMPTION_VALUE = 800

function getPeriodsPerYear(freq: VirginiaPayrollFrequency): number {
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

function getVirginiaStandardDeduction(filingStatus: FilingStatus): number {
  return filingStatus === "marriedJoint"
    ? VIRGINIA_MARRIED_JOINT_STANDARD_DEDUCTION
    : VIRGINIA_SINGLE_STANDARD_DEDUCTION
}

export function isVirginiaWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const state = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    state === "Virginia" ||
    residenceState === "Virginia" ||
    workState === "Virginia"
  )
}

function calculateVirginiaAnnualTax(annualTaxableIncome: number): number {
  if (annualTaxableIncome <= 3000) {
    return annualTaxableIncome * 0.02
  }

  if (annualTaxableIncome <= 5000) {
    return 60 + (annualTaxableIncome - 3000) * 0.03
  }

  if (annualTaxableIncome <= 17000) {
    return 120 + (annualTaxableIncome - 5000) * 0.05
  }

  return 720 + (annualTaxableIncome - 17000) * 0.0575
}

export function calculateVirginiaWithholding(profile: {
  taxableIncome: number
  payFrequency: VirginiaPayrollFrequency
  filingStatus: FilingStatus
  state?: string
  residenceState?: string
  workState?: string
  reciprocityElection?: boolean
  virginiaPersonalExemptions?: number
  virginiaAgeBlindExemptions?: number
  virginiaExempt?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isVirginiaResident = residenceState === "Virginia"
  const worksInVirginia = workState === "Virginia"

  if (profile.virginiaExempt) {
    return 0
  }

  if (!isVirginiaResident && !worksInVirginia && primaryState !== "Virginia") {
    return 0
  }

  if (
    !isVirginiaResident &&
    worksInVirginia &&
    profile.reciprocityElection === true &&
    new Set(["DistrictOfColumbia", "Kentucky", "Maryland", "Pennsylvania", "WestVirginia"]).has(residenceState)
  ) {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualGross = d(profile.taxableIncome).mul(periods)
  const annualTaxableIncome = clampNonNegative(
    annualGross
      .sub(getVirginiaStandardDeduction(profile.filingStatus))
      .sub(d(profile.virginiaPersonalExemptions ?? 0).mul(VIRGINIA_PERSONAL_EXEMPTION_VALUE))
      .sub(d(profile.virginiaAgeBlindExemptions ?? 0).mul(VIRGINIA_AGE_BLIND_EXEMPTION_VALUE))
  )

  return d(calculateVirginiaAnnualTax(annualTaxableIncome.toNumber()))
    .div(periods)
    .toDecimalPlaces(2)
    .toNumber()
}

export const virginiaStrategy: StateTaxStrategy = {
  stateCode: "Virginia",
  applies: (context) => isVirginiaWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (
      residenceState !== "Virginia" &&
      workState === "Virginia" &&
      new Set(["DistrictOfColumbia", "Kentucky", "Maryland", "Pennsylvania", "WestVirginia"]).has(residenceState) &&
      context.reciprocityElection !== true
    ) {
      warnings.push(
        "Virginia has reciprocal withholding agreements with DC, Kentucky, Maryland, Pennsylvania, and West Virginia. If the employee filed a reciprocity exemption certificate, turn on the reciprocity election."
      )
    }

    if (
      residenceState === "Virginia" &&
      workState !== "Virginia"
    ) {
      warnings.push(
        "Virginia resident employees working in another taxing jurisdiction may need resident withholding reduced by the other jurisdiction's withholding, and that offset is not modeled yet."
      )
    }

    return createStateCalculationResult("Virginia VA-4 payroll withholding", "dedicated", {
      stateTax: calculateVirginiaWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        filingStatus: context.filingStatus,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        reciprocityElection: context.reciprocityElection,
        virginiaPersonalExemptions: context.profile.virginiaPersonalExemptions,
        virginiaAgeBlindExemptions: context.profile.virginiaAgeBlindExemptions,
        virginiaExempt: context.profile.virginiaExempt,
      }),
      warnings,
    })
  },
}
