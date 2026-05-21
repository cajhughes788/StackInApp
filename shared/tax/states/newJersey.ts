import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { StateTaxStrategy, TaxProfileInput } from "../types"

type NewJerseyPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

type NewJerseyRateTable = "A" | "B" | "C" | "D" | "E"

type NewJerseyBracket = {
  min: number
  max: number | null
  base: number
  rate: number
}

const NEW_JERSEY_ALLOWANCE_VALUE = 1000

const NEW_JERSEY_RATE_TABLES: Record<NewJerseyRateTable, NewJerseyBracket[]> = {
  A: [
    { min: 0, max: 20000, base: 0, rate: 0.015 },
    { min: 20000, max: 35000, base: 300, rate: 0.02 },
    { min: 35000, max: 40000, base: 600, rate: 0.039 },
    { min: 40000, max: 75000, base: 795, rate: 0.061 },
    { min: 75000, max: 500000, base: 2930, rate: 0.07 },
    { min: 500000, max: 1000000, base: 32680, rate: 0.099 },
    { min: 1000000, max: null, base: 82180, rate: 0.118 },
  ],
  B: [
    { min: 0, max: 20000, base: 0, rate: 0.015 },
    { min: 20000, max: 50000, base: 300, rate: 0.02 },
    { min: 50000, max: 70000, base: 900, rate: 0.027 },
    { min: 70000, max: 80000, base: 1440, rate: 0.039 },
    { min: 80000, max: 150000, base: 1830, rate: 0.061 },
    { min: 150000, max: 500000, base: 6100, rate: 0.07 },
    { min: 500000, max: 1000000, base: 30600, rate: 0.099 },
    { min: 1000000, max: null, base: 80100, rate: 0.118 },
  ],
  C: [
    { min: 0, max: 20000, base: 0, rate: 0.015 },
    { min: 20000, max: 40000, base: 300, rate: 0.023 },
    { min: 40000, max: 50000, base: 760, rate: 0.028 },
    { min: 50000, max: 60000, base: 1040, rate: 0.035 },
    { min: 60000, max: 150000, base: 1390, rate: 0.056 },
    { min: 150000, max: 500000, base: 6430, rate: 0.066 },
    { min: 500000, max: 1000000, base: 29530, rate: 0.099 },
    { min: 1000000, max: null, base: 79030, rate: 0.118 },
  ],
  D: [
    { min: 0, max: 20000, base: 0, rate: 0.015 },
    { min: 20000, max: 40000, base: 300, rate: 0.027 },
    { min: 40000, max: 50000, base: 840, rate: 0.034 },
    { min: 50000, max: 60000, base: 1180, rate: 0.043 },
    { min: 60000, max: 150000, base: 1610, rate: 0.056 },
    { min: 150000, max: 500000, base: 6650, rate: 0.065 },
    { min: 500000, max: 1000000, base: 29400, rate: 0.099 },
    { min: 1000000, max: null, base: 78900, rate: 0.118 },
  ],
  E: [
    { min: 0, max: 20000, base: 0, rate: 0.015 },
    { min: 20000, max: 35000, base: 300, rate: 0.02 },
    { min: 35000, max: 100000, base: 600, rate: 0.058 },
    { min: 100000, max: 500000, base: 4370, rate: 0.065 },
    { min: 500000, max: 1000000, base: 30370, rate: 0.099 },
    { min: 1000000, max: null, base: 79870, rate: 0.118 },
  ],
}

function getPeriodsPerYear(freq: NewJerseyPayrollFrequency): number {
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

function getDefaultNewJerseyRateTable(filingStatus: TaxProfileInput["filingStatus"]): NewJerseyRateTable {
  return filingStatus === "single" || filingStatus === "marriedSeparate" ? "A" : "B"
}

function getBracket(table: NewJerseyRateTable, annualTaxableWages: number): NewJerseyBracket {
  return (
    NEW_JERSEY_RATE_TABLES[table].find(
      (bracket) => annualTaxableWages >= bracket.min && (bracket.max == null || annualTaxableWages < bracket.max)
    ) ?? NEW_JERSEY_RATE_TABLES[table][NEW_JERSEY_RATE_TABLES[table].length - 1]
  )
}

export function isNewJerseyWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const state = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    state === "NewJersey" ||
    residenceState === "NewJersey" ||
    workState === "NewJersey"
  )
}

export function calculateNewJerseyWithholding(profile: {
  taxableIncome: number
  payFrequency: NewJerseyPayrollFrequency
  filingStatus: TaxProfileInput["filingStatus"]
  state?: string
  residenceState?: string
  workState?: string
  reciprocityElection?: boolean
  multiStateWorker?: boolean
  newJerseyRateTable?: NewJerseyRateTable
  newJerseyAllowances?: number
  newJerseyExempt?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isNewJerseyResident = residenceState === "NewJersey"
  const worksInNewJersey = workState === "NewJersey"

  if (profile.newJerseyExempt) {
    return 0
  }

  if (!isNewJerseyResident && !worksInNewJersey && primaryState !== "NewJersey") {
    return 0
  }

  if (
    !isNewJerseyResident &&
    worksInNewJersey &&
    residenceState === "Pennsylvania" &&
    profile.reciprocityElection === true
  ) {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualWages = d(profile.taxableIncome).mul(periods)
  const annualTaxableWages = clampNonNegative(
    annualWages.sub(d(profile.newJerseyAllowances ?? 0).mul(NEW_JERSEY_ALLOWANCE_VALUE))
  )
  const rateTable = profile.newJerseyRateTable ?? getDefaultNewJerseyRateTable(profile.filingStatus)
  const bracket = getBracket(rateTable, annualTaxableWages.toNumber())
  const annualWithholding = d(bracket.base).add(
    annualTaxableWages.sub(bracket.min).mul(bracket.rate)
  )

  return annualWithholding.div(periods).toDecimalPlaces(2).toNumber()
}

export const newJerseyStrategy: StateTaxStrategy = {
  stateCode: "NewJersey",
  applies: (context) => isNewJerseyWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (
      residenceState === "Pennsylvania" &&
      workState === "NewJersey" &&
      context.reciprocityElection !== true
    ) {
      warnings.push(
        "Pennsylvania residents working in New Jersey can be exempt from New Jersey withholding if they filed Form NJ-165. Turn on the reciprocity election if that exemption applies."
      )
    }

    if (
      residenceState === "NewJersey" &&
      workState !== "NewJersey"
    ) {
      warnings.push(
        "New Jersey resident employees working in another taxing jurisdiction may need New Jersey withholding reduced by the other jurisdiction's withholding, and that offset is not modeled yet."
      )
    }

    if (
      residenceState !== "NewJersey" &&
      workState === "NewJersey" &&
      context.multiStateWorker
    ) {
      warnings.push(
        "New Jersey nonresident multistate withholding can require allocating only New Jersey-source wages. This calculator uses the current paycheck's taxable wages as fully New Jersey-source unless you manually adjust the wage base."
      )
    }

    return createStateCalculationResult("New Jersey NJ-W4 payroll withholding", "dedicated", {
      stateTax: calculateNewJerseyWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        filingStatus: context.filingStatus,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        reciprocityElection: context.reciprocityElection,
        multiStateWorker: context.multiStateWorker,
        newJerseyRateTable: context.profile.newJerseyRateTable,
        newJerseyAllowances: context.profile.newJerseyAllowances,
        newJerseyExempt: context.profile.newJerseyExempt,
      }),
      warnings,
    })
  },
}
