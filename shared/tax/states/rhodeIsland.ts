import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { StateTaxStrategy, TaxProfileInput } from "../types"

type RhodeIslandPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

type RhodeIslandBracket = {
  min: number
  max: number | null
  base: number
  rate: number
}

const RHODE_ISLAND_ALLOWANCE_PHASEOUT_THRESHOLD = 290_800

const RHODE_ISLAND_EXEMPTION_PER_ALLOWANCE: Record<RhodeIslandPayrollFrequency, number> = {
  weekly: 19.23,
  biweekly: 38.46,
  "semi-monthly": 41.67,
  monthly: 83.33,
  annual: 1_000,
}

const RHODE_ISLAND_BRACKETS: Record<RhodeIslandPayrollFrequency, RhodeIslandBracket[]> = {
  weekly: [
    { min: 0, max: 1_578, base: 0, rate: 0.0375 },
    { min: 1_578, max: 3_586, base: 59.18, rate: 0.0475 },
    { min: 3_586, max: null, base: 154.56, rate: 0.0599 },
  ],
  biweekly: [
    { min: 0, max: 3_156, base: 0, rate: 0.0375 },
    { min: 3_156, max: 7_171, base: 118.35, rate: 0.0475 },
    { min: 7_171, max: null, base: 309.06, rate: 0.0599 },
  ],
  "semi-monthly": [
    { min: 0, max: 3_419, base: 0, rate: 0.0375 },
    { min: 3_419, max: 7_769, base: 128.21, rate: 0.0475 },
    { min: 7_769, max: null, base: 334.84, rate: 0.0599 },
  ],
  monthly: [
    { min: 0, max: 6_838, base: 0, rate: 0.0375 },
    { min: 6_838, max: 15_538, base: 256.43, rate: 0.0475 },
    { min: 15_538, max: null, base: 669.68, rate: 0.0599 },
  ],
  annual: [
    { min: 0, max: 82_050, base: 0, rate: 0.0375 },
    { min: 82_050, max: 186_450, base: 3_076.88, rate: 0.0475 },
    { min: 186_450, max: null, base: 8_035.88, rate: 0.0599 },
  ],
}

function getPeriodsPerYear(freq: RhodeIslandPayrollFrequency): number {
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

function getRhodeIslandSourceWagesPerPayPeriod(profile: {
  taxableIncome: number
  state?: string
  residenceState?: string
  workState?: string
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")

  if (workState === "RhodeIsland" || primaryState === "RhodeIsland") {
    return profile.taxableIncome
  }

  if (residenceState === "RhodeIsland" && primaryState === "RhodeIsland") {
    return profile.taxableIncome
  }

  return 0
}

function getBracket(freq: RhodeIslandPayrollFrequency, taxableWages: number): RhodeIslandBracket {
  return (
    RHODE_ISLAND_BRACKETS[freq].find(
      (bracket) => taxableWages >= bracket.min && (bracket.max == null || taxableWages <= bracket.max)
    ) ?? RHODE_ISLAND_BRACKETS[freq][RHODE_ISLAND_BRACKETS[freq].length - 1]
  )
}

export function isRhodeIslandWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const state = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    state === "RhodeIsland" ||
    residenceState === "RhodeIsland" ||
    workState === "RhodeIsland"
  )
}

export function calculateRhodeIslandWithholding(profile: {
  taxableIncome: number
  payFrequency: RhodeIslandPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  rhodeIslandAllowances?: number
  rhodeIslandAdditionalWithholding?: number
  rhodeIslandExemptStatus?: "EXEMPT" | "EXEMPT-MS"
}): number {
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const primaryState = normalizeStateKey(profile.state ?? "")
  const isRhodeIslandResident = residenceState === "RhodeIsland"
  const worksInRhodeIsland = workState === "RhodeIsland"

  if (!isRhodeIslandResident && !worksInRhodeIsland && primaryState !== "RhodeIsland") {
    return 0
  }

  if (profile.rhodeIslandExemptStatus) {
    return 0
  }

  const sourceWages = getRhodeIslandSourceWagesPerPayPeriod(profile)
  const additionalWithholding = profile.rhodeIslandAdditionalWithholding ?? 0

  if (sourceWages <= 0) {
    return d(additionalWithholding).toDecimalPlaces(2).toNumber()
  }

  const annualizedWages = d(sourceWages).mul(getPeriodsPerYear(profile.payFrequency)).toNumber()
  const allowanceCount = Math.min(profile.rhodeIslandAllowances ?? 0, 10)
  const perAllowanceAmount =
    annualizedWages > RHODE_ISLAND_ALLOWANCE_PHASEOUT_THRESHOLD
      ? 0
      : RHODE_ISLAND_EXEMPTION_PER_ALLOWANCE[profile.payFrequency]
  const taxableWages = clampNonNegative(d(sourceWages).sub(d(perAllowanceAmount).mul(allowanceCount)))
  const bracket = getBracket(profile.payFrequency, taxableWages.toNumber())
  const withholding = d(bracket.base).add(taxableWages.sub(bracket.min).mul(bracket.rate))

  return withholding.add(additionalWithholding).toDecimalPlaces(2).toNumber()
}

export const rhodeIslandStrategy: StateTaxStrategy = {
  stateCode: "RhodeIsland",
  applies: (context) => isRhodeIslandWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const primaryState = normalizeStateKey(context.state ?? "")
    const warnings: string[] = []

    if (residenceState === "RhodeIsland" && workState !== "RhodeIsland" && primaryState !== "RhodeIsland") {
      warnings.push(
        "Rhode Island withholding is generally based on services performed in Rhode Island. If the employee does not work in Rhode Island, Rhode Island withholding is usually not required unless the employer is doing convenience withholding."
      )
    }

    if (residenceState === "RhodeIsland" && workState !== "RhodeIsland" && primaryState === "RhodeIsland") {
      warnings.push(
        "This Rhode Island estimate treats the selected primary withholding state as convenience withholding for a Rhode Island resident working outside the state."
      )
    }

    if ((context.profile.rhodeIslandAllowances ?? 0) > 10) {
      warnings.push(
        "Rhode Island Form RI-W4 caps the regular allowance count at 10, so this calculator limits the allowance count to 10."
      )
    }

    if (context.profile.rhodeIslandExemptStatus === "EXEMPT-MS" && residenceState === "RhodeIsland") {
      warnings.push(
        "Rhode Island EXEMPT-MS status is generally for a qualifying nonresident military spouse, so review that election if the employee is a Rhode Island resident."
      )
    }

    if (context.profile.rhodeIslandExemptStatus === "EXEMPT") {
      warnings.push(
        "Rhode Island EXEMPT status must be renewed each year and should be used only when the employee expects no Rhode Island tax liability for the year."
      )
    }

    return createStateCalculationResult("Rhode Island RI-W4 payroll withholding", "dedicated", {
      stateTax: calculateRhodeIslandWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        rhodeIslandAllowances: context.profile.rhodeIslandAllowances,
        rhodeIslandAdditionalWithholding: context.profile.rhodeIslandAdditionalWithholding,
        rhodeIslandExemptStatus: context.profile.rhodeIslandExemptStatus,
      }),
      warnings,
    })
  },
}
