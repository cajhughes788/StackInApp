import { d, clampNonNegative, max, min } from "../math"
import {
  MARYLAND_NONRESIDENT_LOCAL_RATE,
  getMarylandLocalRate,
} from "../tables/marylandLocalRates"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type MarylandPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

interface MarylandAllowanceConfig {
  exemptionValue: number
  standardDeductionMin: number
  standardDeductionMax: number
}

interface MarylandWithholdingBracket {
  upTo: number | null
  rate: number
}

const ALLOWANCES: Record<MarylandPayrollFrequency, MarylandAllowanceConfig> = {
  weekly: {
    exemptionValue: 3200 / 52,
    standardDeductionMin: 1850 / 52,
    standardDeductionMax: 2800 / 52,
  },
  biweekly: {
    exemptionValue: 3200 / 26,
    standardDeductionMin: 1850 / 26,
    standardDeductionMax: 2800 / 26,
  },
  "semi-monthly": {
    exemptionValue: 3200 / 24,
    standardDeductionMin: 1850 / 24,
    standardDeductionMax: 2800 / 24,
  },
  monthly: {
    exemptionValue: 3200 / 12,
    standardDeductionMin: 1850 / 12,
    standardDeductionMax: 2800 / 12,
  },
  annual: {
    exemptionValue: 3200,
    standardDeductionMin: 1850,
    standardDeductionMax: 2800,
  },
}

const SINGLE_STYLE_BRACKETS: MarylandWithholdingBracket[] = [
  { upTo: 100000, rate: 0.0475 },
  { upTo: 125000, rate: 0.05 },
  { upTo: 150000, rate: 0.0525 },
  { upTo: 250000, rate: 0.055 },
  { upTo: null, rate: 0.0575 },
]

const JOINT_STYLE_BRACKETS: MarylandWithholdingBracket[] = [
  { upTo: 150000, rate: 0.0475 },
  { upTo: 175000, rate: 0.05 },
  { upTo: 225000, rate: 0.0525 },
  { upTo: 300000, rate: 0.055 },
  { upTo: null, rate: 0.0575 },
]

function getPeriodsPerYear(freq: MarylandPayrollFrequency): number {
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

function getMarylandAllowances(freq: MarylandPayrollFrequency): MarylandAllowanceConfig {
  return ALLOWANCES[freq]
}

function getMarylandBrackets(
  filingStatus: FilingStatus
): MarylandWithholdingBracket[] {
  switch (filingStatus) {
    case "marriedJoint":
    case "headOfHousehold":
      return JOINT_STYLE_BRACKETS
    case "single":
    case "marriedSeparate":
      return SINGLE_STYLE_BRACKETS
  }
}

function calculateBracketTax(
  annualTaxableIncome: number,
  annualBrackets: MarylandWithholdingBracket[],
  localRate: number
): number {
  let annualTax = d(0)
  let previousLimit = d(0)
  const adjustedIncome = d(annualTaxableIncome)

  for (const bracket of annualBrackets) {
    const upper = bracket.upTo == null ? null : d(bracket.upTo)
    const combinedRate = d(bracket.rate).add(localRate)

    if (upper && adjustedIncome.gt(upper)) {
      annualTax = annualTax.add(upper.sub(previousLimit).mul(combinedRate))
      previousLimit = upper
      continue
    }

    const taxableAtThisRate = adjustedIncome.sub(previousLimit)
    if (taxableAtThisRate.gt(0)) {
      annualTax = annualTax.add(taxableAtThisRate.mul(combinedRate))
    }
    break
  }

  return annualTax.toNumber()
}

export function isMarylandWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const state = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    state === "Maryland" ||
    residenceState === "Maryland" ||
    workState === "Maryland"
  )
}

export function calculateMarylandWithholding(profile: {
  taxableIncome: number
  filingStatus: FilingStatus
  payFrequency: MarylandPayrollFrequency
  dependents?: number
  marylandWithholdingExemptions?: number
  stateWithholdingExemptions?: number
  state?: string
  residenceState?: string
  workState?: string
  residenceCounty?: string
  workCounty?: string
  reciprocityElection?: boolean
}): { state: number; local: number; taxableIncome: number } {
  const residenceState = normalizeStateKey(
    profile.residenceState ?? profile.state ?? ""
  )
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isMarylandResident = residenceState === "Maryland"
  const worksOutsideMaryland = workState !== "" && workState !== "Maryland"
  const usesDelawareNonreciprocalRate =
    isMarylandResident &&
    worksOutsideMaryland &&
    profile.reciprocityElection !== true

  if (profile.reciprocityElection && !isMarylandResident) {
    return { state: 0, local: 0, taxableIncome: 0 }
  }

  const allowances = getMarylandAllowances(profile.payFrequency)
  const exemptionCount =
    profile.marylandWithholdingExemptions
    ?? profile.stateWithholdingExemptions
    ?? profile.dependents
    ?? 0
  const standardDeduction = min(
    max(
      d(profile.taxableIncome).mul(0.15),
      d(allowances.standardDeductionMin)
    ),
    d(allowances.standardDeductionMax)
  )
  const perPeriodTaxableIncome = clampNonNegative(
    d(profile.taxableIncome)
      .sub(standardDeduction)
      .sub(d(allowances.exemptionValue).mul(exemptionCount))
  )

  if (perPeriodTaxableIncome.lte(0)) {
    return { state: 0, local: 0, taxableIncome: 0 }
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualTaxableIncome = perPeriodTaxableIncome.mul(periods).toNumber()
  let localRate = 0

  if (usesDelawareNonreciprocalRate) {
    return {
      state: 0,
      local: perPeriodTaxableIncome.mul(0.032).toDecimalPlaces(2).toNumber(),
      taxableIncome: perPeriodTaxableIncome.toDecimalPlaces(2).toNumber(),
    }
  }

  const brackets = getMarylandBrackets(profile.filingStatus)
  if (isMarylandResident) {
    localRate =
      getMarylandLocalRate(
        profile.residenceCounty ?? profile.workCounty,
        profile.filingStatus,
        annualTaxableIncome
      ) ?? 0
  } else if (workState === "Maryland") {
    localRate = MARYLAND_NONRESIDENT_LOCAL_RATE
  }

  const annualStateOnly = calculateBracketTax(annualTaxableIncome, brackets, 0)
  const annualCombined = calculateBracketTax(
    annualTaxableIncome,
    brackets,
    localRate
  )

  const state = d(annualStateOnly).div(periods).toDecimalPlaces(2)
  const combined = d(annualCombined).div(periods).toDecimalPlaces(2)
  const local = clampNonNegative(combined.sub(state)).toDecimalPlaces(2)

  return {
    state: state.toNumber(),
    local: local.toNumber(),
    taxableIncome: perPeriodTaxableIncome.toDecimalPlaces(2).toNumber(),
  }
}

export const marylandStrategy: StateTaxStrategy = {
  stateCode: "Maryland",
  applies: (context) => isMarylandWithholdingState(context),
  calculate: (context) => {
    const result = calculateMarylandWithholding({
      taxableIncome: context.taxableIncome,
      filingStatus: context.filingStatus,
      dependents: context.dependents,
      marylandWithholdingExemptions: context.profile.marylandWithholdingExemptions,
      stateWithholdingExemptions: context.profile.stateWithholdingExemptions,
      payFrequency: context.payFrequency,
      state: context.state,
      residenceState: context.residenceState,
      workState: context.workState,
      residenceCounty: context.residenceCounty,
      workCounty: context.workCounty,
      reciprocityElection: context.reciprocityElection,
    })

    return createStateCalculationResult("Maryland dedicated payroll withholding", "dedicated", {
      stateTax: result.state,
    })
  },
}
