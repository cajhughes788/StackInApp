import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { StateTaxStrategy, TaxProfileInput } from "../types"

type OhioPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

type OhioPercentageTable = {
  exemptionValue: number
  firstThreshold: number
  secondThreshold: number
  firstRate: number
  secondRate: number
  thirdRate: number
  secondBase: number
  thirdBase: number
}

const OHIO_RECIPROCITY_STATES = new Set([
  "Indiana",
  "Kentucky",
  "Michigan",
  "Pennsylvania",
  "WestVirginia",
])

const OHIO_TABLES: Record<OhioPayrollFrequency, OhioPercentageTable> = {
  weekly: {
    exemptionValue: 12.5,
    firstThreshold: 500.96,
    secondThreshold: 1_923.08,
    firstRate: 0.01775,
    secondRate: 0.0299,
    thirdRate: 0.0364,
    secondBase: 8.89,
    thirdBase: 51.41,
  },
  biweekly: {
    exemptionValue: 25,
    firstThreshold: 1_001.92,
    secondThreshold: 3_846.15,
    firstRate: 0.01775,
    secondRate: 0.0299,
    thirdRate: 0.0364,
    secondBase: 17.78,
    thirdBase: 102.82,
  },
  "semi-monthly": {
    exemptionValue: 27.08,
    firstThreshold: 1_085.42,
    secondThreshold: 4_166.67,
    firstRate: 0.01775,
    secondRate: 0.0299,
    thirdRate: 0.0364,
    secondBase: 19.27,
    thirdBase: 111.4,
  },
  monthly: {
    exemptionValue: 54.17,
    firstThreshold: 2_170.83,
    secondThreshold: 8_333.33,
    firstRate: 0.01775,
    secondRate: 0.0299,
    thirdRate: 0.0364,
    secondBase: 38.53,
    thirdBase: 222.79,
  },
  annual: {
    exemptionValue: 650,
    firstThreshold: 26_050,
    secondThreshold: 100_000,
    firstRate: 0.01775,
    secondRate: 0.0299,
    thirdRate: 0.0364,
    secondBase: 462.39,
    thirdBase: 3_135.49,
  },
}

function isOhioWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")

  return (
    primaryState === "Ohio" ||
    residenceState === "Ohio" ||
    workState === "Ohio"
  )
}

function isOhioStateWithholdingExempt(profile: {
  state?: string
  residenceState?: string
  workState?: string
  reciprocityElection?: boolean
  ohioResidentMilitaryOutsideOhioExempt?: boolean
  ohioNonresidentMilitaryExempt?: boolean
  ohioNonresidentMilitarySpouseExempt?: boolean
  ohioStatutoryExempt?: boolean
}): boolean {
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const residentInOhio = residenceState === "Ohio"
  const worksInOhio = workState === "Ohio"

  if (profile.ohioStatutoryExempt) {
    return true
  }

  if (residentInOhio && !worksInOhio && profile.ohioResidentMilitaryOutsideOhioExempt) {
    return true
  }

  if (!residentInOhio && worksInOhio && profile.ohioNonresidentMilitaryExempt) {
    return true
  }

  if (!residentInOhio && worksInOhio && profile.ohioNonresidentMilitarySpouseExempt) {
    return true
  }

  if (
    !residentInOhio &&
    worksInOhio &&
    profile.reciprocityElection &&
    OHIO_RECIPROCITY_STATES.has(residenceState)
  ) {
    return true
  }

  return !residentInOhio && !worksInOhio
}

function calculateOhioPercentageWithholding(
  taxableIncome: number,
  exemptions: number,
  payFrequency: OhioPayrollFrequency
): number {
  const table = OHIO_TABLES[payFrequency]
  const taxableWages = clampNonNegative(
    d(taxableIncome).sub(d(table.exemptionValue).mul(exemptions))
  ).toNumber()

  if (taxableWages <= table.firstThreshold) {
    return d(taxableWages).mul(table.firstRate).toDecimalPlaces(2).toNumber()
  }

  if (taxableWages <= table.secondThreshold) {
    return d(table.secondBase)
      .add(d(taxableWages - table.firstThreshold).mul(table.secondRate))
      .toDecimalPlaces(2)
      .toNumber()
  }

  return d(table.thirdBase)
    .add(d(taxableWages - table.secondThreshold).mul(table.thirdRate))
    .toDecimalPlaces(2)
    .toNumber()
}

function calculateOhioStateWithholding(profile: {
  taxableIncome: number
  payFrequency: OhioPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  reciprocityElection?: boolean
  ohioExemptions?: number
  ohioAdditionalStateWithholding?: number
  ohioResidentMilitaryOutsideOhioExempt?: boolean
  ohioNonresidentMilitaryExempt?: boolean
  ohioNonresidentMilitarySpouseExempt?: boolean
  ohioStatutoryExempt?: boolean
}): number {
  if (!isOhioWithholdingState(profile)) {
    return 0
  }

  if (isOhioStateWithholdingExempt(profile)) {
    return 0
  }

  return d(
    calculateOhioPercentageWithholding(
      profile.taxableIncome,
      profile.ohioExemptions ?? 0,
      profile.payFrequency
    )
  )
    .add(profile.ohioAdditionalStateWithholding ?? 0)
    .toDecimalPlaces(2)
    .toNumber()
}

export const ohioStrategy: StateTaxStrategy = {
  stateCode: "Ohio",
  applies: (context) => isOhioWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const residentInOhio = residenceState === "Ohio"
    const worksInOhio = workState === "Ohio"
    const warnings: string[] = []

    if (
      !residentInOhio &&
      worksInOhio &&
      OHIO_RECIPROCITY_STATES.has(residenceState) &&
      !context.reciprocityElection
    ) {
      warnings.push(
        "Ohio reciprocity for Indiana, Kentucky, Michigan, Pennsylvania, and West Virginia residents is only applied here when the reciprocity election is turned on."
      )
    }

    if (worksInOhio && (context.profile.ohioExemptions ?? 0) === 0) {
      warnings.push(
        "Ohio withholding defaults to zero exemptions when no Ohio IT 4 exemption count is stored."
      )
    }

    if (residentInOhio && !worksInOhio) {
      warnings.push(
        "Ohio resident wages earned outside Ohio can still require Ohio withholding, but other-state credits and multistate wage sourcing remain employer-specific."
      )
    }

    return createStateCalculationResult("Ohio employer withholding percentage method", "dedicated", {
      stateTax: calculateOhioStateWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        reciprocityElection: context.reciprocityElection,
        ohioExemptions: context.profile.ohioExemptions,
        ohioAdditionalStateWithholding: context.profile.ohioAdditionalStateWithholding,
        ohioResidentMilitaryOutsideOhioExempt: context.profile.ohioResidentMilitaryOutsideOhioExempt,
        ohioNonresidentMilitaryExempt: context.profile.ohioNonresidentMilitaryExempt,
        ohioNonresidentMilitarySpouseExempt: context.profile.ohioNonresidentMilitarySpouseExempt,
        ohioStatutoryExempt: context.profile.ohioStatutoryExempt,
      }),
      warnings,
    })
  },
}
