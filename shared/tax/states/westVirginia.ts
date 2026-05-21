import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { StateTaxStrategy, TaxProfileInput } from "../types"

type WestVirginiaPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

type WestVirginiaBracket = {
  upper: number | null
  lower: number
  baseTax: number
  rate: number
}

const WEST_VIRGINIA_RECIPROCITY_STATES = new Set([
  "Kentucky",
  "Maryland",
  "Ohio",
  "Pennsylvania",
  "Virginia",
])

const WEST_VIRGINIA_ONE_EARNER_BRACKETS: WestVirginiaBracket[] = [
  { upper: 10_000, lower: 0, baseTax: 0, rate: 0.0211 },
  { upper: 25_000, lower: 10_000, baseTax: 211, rate: 0.0281 },
  { upper: 40_000, lower: 25_000, baseTax: 632.5, rate: 0.0316 },
  { upper: 60_000, lower: 40_000, baseTax: 1_106.5, rate: 0.0422 },
  { upper: null, lower: 60_000, baseTax: 1_950.5, rate: 0.0458 },
]

const WEST_VIRGINIA_TWO_EARNER_BRACKETS: WestVirginiaBracket[] = [
  { upper: 7_500, lower: 0, baseTax: 0, rate: 0.0211 },
  { upper: 18_750, lower: 7_500, baseTax: 158.25, rate: 0.0281 },
  { upper: 30_000, lower: 18_750, baseTax: 474.38, rate: 0.0316 },
  { upper: 45_000, lower: 30_000, baseTax: 829.88, rate: 0.0422 },
  { upper: null, lower: 45_000, baseTax: 1_462.88, rate: 0.0458 },
]

function getPeriodsPerYear(freq: WestVirginiaPayrollFrequency): number {
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

function calculateFromBrackets(amount: number, brackets: WestVirginiaBracket[]): number {
  for (const bracket of brackets) {
    if (bracket.upper == null || amount <= bracket.upper) {
      return bracket.baseTax + (amount - bracket.lower) * bracket.rate
    }
  }

  return 0
}

export function isWestVirginiaWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    primaryState === "WestVirginia" ||
    residenceState === "WestVirginia" ||
    workState === "WestVirginia"
  )
}

export function calculateWestVirginiaWithholding(profile: {
  taxableIncome: number
  payFrequency: WestVirginiaPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  reciprocityElection?: boolean
  westVirginiaWithholdingExemptions?: number
  stateWithholdingExemptions?: number
  westVirginiaLowerRateElection?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isResident = residenceState === "WestVirginia"
  const worksInState = workState === "WestVirginia"

  if (!isResident && !worksInState && primaryState !== "WestVirginia") {
    return 0
  }

  if (
    !isResident &&
    worksInState &&
    profile.reciprocityElection &&
    WEST_VIRGINIA_RECIPROCITY_STATES.has(residenceState)
  ) {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const exemptionCount =
    profile.westVirginiaWithholdingExemptions ?? profile.stateWithholdingExemptions ?? 0
  const annualTaxableWages = clampNonNegative(
    d(profile.taxableIncome)
      .mul(periods)
      .sub(d(exemptionCount).mul(2_000))
  ).toNumber()
  const brackets = profile.westVirginiaLowerRateElection
    ? WEST_VIRGINIA_ONE_EARNER_BRACKETS
    : WEST_VIRGINIA_TWO_EARNER_BRACKETS
  const annualTax = calculateFromBrackets(annualTaxableWages, brackets)

  return d(annualTax).div(periods).toDecimalPlaces(2).toNumber()
}

export const westVirginiaStrategy: StateTaxStrategy = {
  stateCode: "WestVirginia",
  applies: (context) => isWestVirginiaWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (
      residenceState !== "WestVirginia" &&
      workState === "WestVirginia" &&
      WEST_VIRGINIA_RECIPROCITY_STATES.has(residenceState) &&
      !context.reciprocityElection
    ) {
      warnings.push(
        "West Virginia reciprocity for residents of Kentucky, Maryland, Ohio, Pennsylvania, or Virginia is only applied here when the reciprocity election is turned on."
      )
    }

    warnings.push(
      "West Virginia Form IT-104 special nonresident military-spouse exemptions and the certificate-based lower-rate election are only modeled when the matching profile inputs are provided."
    )

    return createStateCalculationResult("West Virginia IT-100.2.A payroll withholding", "dedicated", {
      stateTax: calculateWestVirginiaWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        reciprocityElection: context.reciprocityElection,
        westVirginiaWithholdingExemptions:
          context.profile.westVirginiaWithholdingExemptions,
        stateWithholdingExemptions: context.profile.stateWithholdingExemptions,
        westVirginiaLowerRateElection: context.profile.westVirginiaLowerRateElection,
      }),
      warnings,
    })
  },
}
