import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { StateTaxStrategy, TaxProfileInput } from "../types"

type IndianaPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

const INDIANA_RECIPROCITY_STATES = new Set([
  "Kentucky",
  "Michigan",
  "Ohio",
  "Pennsylvania",
  "Wisconsin",
])

const INDIANA_PERSONAL_EXEMPTION_VALUE = 1_000
const INDIANA_DEPENDENT_EXEMPTION_VALUE = 1_500
const INDIANA_ADOPTED_CHILD_EXEMPTION_VALUE = 3_000
const INDIANA_STATE_RATE = 0.0295

function getPeriodsPerYear(freq: IndianaPayrollFrequency): number {
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

function roundIndianaDeduction(value: number): number {
  return d(value).toDecimalPlaces(2).toNumber()
}

export function isIndianaWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    primaryState === "Indiana" ||
    residenceState === "Indiana" ||
    workState === "Indiana"
  )
}

export function isIndianaStateWithholdingExempt(profile: {
  state?: string
  residenceState?: string
  workState?: string
  reciprocityElection?: boolean
  indianaNonresidentThirtyDayExempt?: boolean
  indianaNonresidentMilitarySpouseExempt?: boolean
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isResident = residenceState === "Indiana"
  const worksInIndiana = workState === "Indiana"

  if (!isResident && worksInIndiana && profile.indianaNonresidentThirtyDayExempt) {
    return true
  }

  if (!isResident && worksInIndiana && profile.indianaNonresidentMilitarySpouseExempt) {
    return true
  }

  if (
    !isResident &&
    worksInIndiana &&
    profile.reciprocityElection &&
    INDIANA_RECIPROCITY_STATES.has(residenceState)
  ) {
    return true
  }

  return primaryState !== "Indiana" && !isResident && !worksInIndiana
}

export function getIndianaDeductionConstant(profile: {
  payFrequency: IndianaPayrollFrequency
  indianaPersonalExemptions?: number
  indianaDependentExemptions?: number
  indianaFirstTimeDependentExemptions?: number
  indianaAdoptedChildExemptions?: number
}): number {
  const periods = getPeriodsPerYear(profile.payFrequency)
  const personalExemptions = profile.indianaPersonalExemptions ?? 0
  const dependentExemptions = profile.indianaDependentExemptions ?? 0
  const firstTimeDependentExemptions = profile.indianaFirstTimeDependentExemptions ?? 0
  const adoptedChildExemptions = profile.indianaAdoptedChildExemptions ?? 0

  const personalDeduction = roundIndianaDeduction(
    (personalExemptions * INDIANA_PERSONAL_EXEMPTION_VALUE) / periods
  )
  const dependentDeduction = roundIndianaDeduction(
    (dependentExemptions * INDIANA_DEPENDENT_EXEMPTION_VALUE) / periods
  )
  const firstTimeDependentDeduction = roundIndianaDeduction(
    (firstTimeDependentExemptions * INDIANA_DEPENDENT_EXEMPTION_VALUE) / periods
  )
  const adoptedChildDeduction = roundIndianaDeduction(
    (adoptedChildExemptions * INDIANA_ADOPTED_CHILD_EXEMPTION_VALUE) / periods
  )

  return d(personalDeduction)
    .add(dependentDeduction)
    .add(firstTimeDependentDeduction)
    .add(adoptedChildDeduction)
    .toDecimalPlaces(2)
    .toNumber()
}

export function getIndianaTaxableWages(profile: {
  taxableIncome: number
  payFrequency: IndianaPayrollFrequency
  indianaPersonalExemptions?: number
  indianaDependentExemptions?: number
  indianaFirstTimeDependentExemptions?: number
  indianaAdoptedChildExemptions?: number
}): number {
  return clampNonNegative(
    d(profile.taxableIncome).sub(
      getIndianaDeductionConstant({
        payFrequency: profile.payFrequency,
        indianaPersonalExemptions: profile.indianaPersonalExemptions,
        indianaDependentExemptions: profile.indianaDependentExemptions,
        indianaFirstTimeDependentExemptions: profile.indianaFirstTimeDependentExemptions,
        indianaAdoptedChildExemptions: profile.indianaAdoptedChildExemptions,
      })
    )
  )
    .toDecimalPlaces(2)
    .toNumber()
}

export function calculateIndianaWithholding(profile: {
  taxableIncome: number
  payFrequency: IndianaPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  reciprocityElection?: boolean
  indianaPersonalExemptions?: number
  indianaDependentExemptions?: number
  indianaFirstTimeDependentExemptions?: number
  indianaAdoptedChildExemptions?: number
  indianaAdditionalStateWithholding?: number
  indianaNonresidentThirtyDayExempt?: boolean
  indianaNonresidentMilitarySpouseExempt?: boolean
}): number {
  if (!isIndianaWithholdingState(profile)) {
    return 0
  }

  if (isIndianaStateWithholdingExempt(profile)) {
    return 0
  }

  const taxableWages = getIndianaTaxableWages({
    taxableIncome: profile.taxableIncome,
    payFrequency: profile.payFrequency,
    indianaPersonalExemptions: profile.indianaPersonalExemptions,
    indianaDependentExemptions: profile.indianaDependentExemptions,
    indianaFirstTimeDependentExemptions: profile.indianaFirstTimeDependentExemptions,
    indianaAdoptedChildExemptions: profile.indianaAdoptedChildExemptions,
  })

  return d(taxableWages)
    .mul(INDIANA_STATE_RATE)
    .add(profile.indianaAdditionalStateWithholding ?? 0)
    .toDecimalPlaces(2)
    .toNumber()
}

export const indianaStrategy: StateTaxStrategy = {
  stateCode: "Indiana",
  applies: (context) => isIndianaWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (
      residenceState !== "Indiana" &&
      workState === "Indiana" &&
      INDIANA_RECIPROCITY_STATES.has(residenceState) &&
      !context.reciprocityElection
    ) {
      warnings.push(
        "Indiana reciprocity for Kentucky, Michigan, Ohio, Pennsylvania, and Wisconsin residents is only applied here when the reciprocity election is turned on."
      )
    }

    if (
      residenceState !== "Indiana" &&
      workState === "Indiana" &&
      !context.profile.indianaNonresidentThirtyDayExempt
    ) {
      warnings.push(
        "Indiana nonresident employees who will work in Indiana for 30 days or less can use Form WH-4AFF to stop withholding, but that certificate-based exception is only applied here when the 30-day waiver toggle is turned on."
      )
    }

    if (residenceState === "Indiana" && workState !== "Indiana") {
      warnings.push(
        "Indiana resident wages earned in another state can require resident credits or employer-specific multistate withholding coordination that is not fully determined here."
      )
    }

    return createStateCalculationResult("Indiana WH-4 payroll withholding", "dedicated", {
      stateTax: calculateIndianaWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        reciprocityElection: context.reciprocityElection,
        indianaPersonalExemptions: context.profile.indianaPersonalExemptions,
        indianaDependentExemptions: context.profile.indianaDependentExemptions,
        indianaFirstTimeDependentExemptions: context.profile.indianaFirstTimeDependentExemptions,
        indianaAdoptedChildExemptions: context.profile.indianaAdoptedChildExemptions,
        indianaAdditionalStateWithholding: context.profile.indianaAdditionalStateWithholding,
        indianaNonresidentThirtyDayExempt: context.profile.indianaNonresidentThirtyDayExempt,
        indianaNonresidentMilitarySpouseExempt: context.profile.indianaNonresidentMilitarySpouseExempt,
      }),
      warnings,
    })
  },
}
