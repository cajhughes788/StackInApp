import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type NewYorkPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

type NewYorkBracket = {
  min: number
  max: number | null
  subtract: number
  rate: number
  base: number
}

type NewYorkTopRateBand = {
  min: number
  max: number | null
  rate: number
}

const NEW_YORK_DEDUCTION_ALLOWANCE = {
  single: {
    weekly: 142.3,
    biweekly: 284.6,
    "semi-monthly": 308.35,
    monthly: 616.7,
    annual: 7_400,
  },
  married: {
    weekly: 152.9,
    biweekly: 305.8,
    "semi-monthly": 331.25,
    monthly: 662.5,
    annual: 7_950,
  },
} as const satisfies Record<"single" | "married", Record<NewYorkPayrollFrequency, number>>

const NEW_YORK_EXEMPTION_VALUE = {
  weekly: 19.25,
  biweekly: 38.5,
  "semi-monthly": 41.65,
  monthly: 83.3,
  annual: 1_000,
} as const satisfies Record<NewYorkPayrollFrequency, number>

const SINGLE_EXACT_TABLES: Record<NewYorkPayrollFrequency, NewYorkBracket[]> = {
  weekly: [
    { min: 0, max: 163, subtract: 0, rate: 0.039, base: 0 },
    { min: 163, max: 225, subtract: 163, rate: 0.044, base: 6.38 },
    { min: 225, max: 267, subtract: 225, rate: 0.0515, base: 9.08 },
    { min: 267, max: 1_551, subtract: 267, rate: 0.054, base: 11.27 },
    { min: 1_551, max: 1_862, subtract: 1_551, rate: 0.059, base: 80.58 },
    { min: 1_862, max: 2_070, subtract: 1_862, rate: 0.0703, base: 98.9 },
    { min: 2_070, max: 3_032, subtract: 2_070, rate: 0.0753, base: 113.58 },
    { min: 3_032, max: 4_142, subtract: 3_032, rate: 0.064, base: 186.02 },
    { min: 4_142, max: 5_104, subtract: 4_142, rate: 0.1144, base: 257.1 },
    { min: 5_104, max: 20_722, subtract: 5_104, rate: 0.0735, base: 367.13 },
    { min: 20_722, max: null, subtract: 20_722, rate: 0.0765, base: 1_526.33 },
  ],
  biweekly: [
    { min: 0, max: 327, subtract: 0, rate: 0.039, base: 0 },
    { min: 327, max: 450, subtract: 327, rate: 0.044, base: 12.77 },
    { min: 450, max: 535, subtract: 450, rate: 0.0515, base: 18.15 },
    { min: 535, max: 3_102, subtract: 535, rate: 0.054, base: 22.54 },
    { min: 3_102, max: 3_723, subtract: 3_102, rate: 0.059, base: 161.15 },
    { min: 3_723, max: 4_140, subtract: 3_723, rate: 0.0703, base: 197.81 },
    { min: 4_140, max: 6_063, subtract: 4_140, rate: 0.0753, base: 227.15 },
    { min: 6_063, max: 8_285, subtract: 6_063, rate: 0.064, base: 372.04 },
    { min: 8_285, max: 10_208, subtract: 8_285, rate: 0.1144, base: 514.19 },
    { min: 10_208, max: 41_444, subtract: 10_208, rate: 0.0735, base: 734.27 },
    { min: 41_444, max: null, subtract: 41_444, rate: 0.0765, base: 3_052.65 },
  ],
  "semi-monthly": [
    { min: 0, max: 354, subtract: 0, rate: 0.039, base: 0 },
    { min: 354, max: 488, subtract: 354, rate: 0.044, base: 13.83 },
    { min: 488, max: 579, subtract: 488, rate: 0.0515, base: 19.67 },
    { min: 579, max: 3_360, subtract: 579, rate: 0.054, base: 24.42 },
    { min: 3_360, max: 4_033, subtract: 3_360, rate: 0.059, base: 174.58 },
    { min: 4_033, max: 4_485, subtract: 4_033, rate: 0.0703, base: 214.29 },
    { min: 4_485, max: 6_569, subtract: 4_485, rate: 0.0753, base: 246.08 },
    { min: 6_569, max: 8_975, subtract: 6_569, rate: 0.064, base: 403.04 },
    { min: 8_975, max: 11_058, subtract: 8_975, rate: 0.1144, base: 557.04 },
    { min: 11_058, max: 44_898, subtract: 11_058, rate: 0.0735, base: 795.46 },
    { min: 44_898, max: null, subtract: 44_898, rate: 0.0765, base: 3_307.04 },
  ],
  monthly: [
    { min: 0, max: 708, subtract: 0, rate: 0.039, base: 0 },
    { min: 708, max: 975, subtract: 708, rate: 0.044, base: 27.67 },
    { min: 975, max: 1_158, subtract: 975, rate: 0.0515, base: 39.33 },
    { min: 1_158, max: 6_721, subtract: 1_158, rate: 0.054, base: 48.83 },
    { min: 6_721, max: 8_067, subtract: 6_721, rate: 0.059, base: 349.17 },
    { min: 8_067, max: 8_971, subtract: 8_067, rate: 0.0703, base: 428.58 },
    { min: 8_971, max: 13_138, subtract: 8_971, rate: 0.0753, base: 492.17 },
    { min: 13_138, max: 17_950, subtract: 13_138, rate: 0.064, base: 806.08 },
    { min: 17_950, max: 22_117, subtract: 17_950, rate: 0.1144, base: 1_114.08 },
    { min: 22_117, max: 89_796, subtract: 22_117, rate: 0.0735, base: 1_590.92 },
    { min: 89_796, max: null, subtract: 89_796, rate: 0.0765, base: 6_614.08 },
  ],
  annual: [
    { min: 0, max: 8_500, subtract: 0, rate: 0.039, base: 0 },
    { min: 8_500, max: 11_700, subtract: 8_500, rate: 0.044, base: 332 },
    { min: 11_700, max: 13_900, subtract: 11_700, rate: 0.0515, base: 472 },
    { min: 13_900, max: 80_650, subtract: 13_900, rate: 0.054, base: 586 },
    { min: 80_650, max: 96_800, subtract: 80_650, rate: 0.059, base: 4_190 },
    { min: 96_800, max: 107_650, subtract: 96_800, rate: 0.0703, base: 5_143 },
    { min: 107_650, max: 157_650, subtract: 107_650, rate: 0.0753, base: 5_906 },
    { min: 157_650, max: 215_400, subtract: 157_650, rate: 0.064, base: 9_673 },
    { min: 215_400, max: 265_400, subtract: 215_400, rate: 0.1144, base: 13_369 },
    { min: 265_400, max: 1_077_550, subtract: 265_400, rate: 0.0735, base: 19_091 },
    { min: 1_077_550, max: null, subtract: 1_077_550, rate: 0.0765, base: 79_369 },
  ],
}

const MARRIED_EXACT_TABLES: Record<NewYorkPayrollFrequency, NewYorkBracket[]> = {
  weekly: [
    { min: 0, max: 163, subtract: 0, rate: 0.039, base: 0 },
    { min: 163, max: 225, subtract: 163, rate: 0.044, base: 6.38 },
    { min: 225, max: 267, subtract: 225, rate: 0.0515, base: 9.08 },
    { min: 267, max: 1_551, subtract: 267, rate: 0.054, base: 11.27 },
    { min: 1_551, max: 1_862, subtract: 1_551, rate: 0.059, base: 80.58 },
    { min: 1_862, max: 2_070, subtract: 1_862, rate: 0.0657, base: 98.9 },
    { min: 2_070, max: 3_032, subtract: 2_070, rate: 0.0707, base: 112.6 },
    { min: 3_032, max: 4_068, subtract: 3_032, rate: 0.0801, base: 180.54 },
    { min: 4_068, max: 6_215, subtract: 4_068, rate: 0.064, base: 263.62 },
    { min: 6_215, max: 7_177, subtract: 6_215, rate: 0.1349, base: 401.04 },
    { min: 7_177, max: 20_722, subtract: 7_177, rate: 0.0735, base: 530.77 },
    { min: 20_722, max: 41_449, subtract: 20_722, rate: 0.0765, base: 1_526.33 },
    { min: 41_449, max: null, subtract: 41_449, rate: 0.109, base: 3_112.02 },
  ],
  biweekly: [
    { min: 0, max: 327, subtract: 0, rate: 0.039, base: 0 },
    { min: 327, max: 450, subtract: 327, rate: 0.044, base: 12.77 },
    { min: 450, max: 535, subtract: 450, rate: 0.0515, base: 18.15 },
    { min: 535, max: 3_102, subtract: 535, rate: 0.054, base: 22.54 },
    { min: 3_102, max: 3_723, subtract: 3_102, rate: 0.059, base: 161.15 },
    { min: 3_723, max: 4_140, subtract: 3_723, rate: 0.0657, base: 197.81 },
    { min: 4_140, max: 6_063, subtract: 4_140, rate: 0.0707, base: 225.19 },
    { min: 6_063, max: 8_137, subtract: 6_063, rate: 0.0801, base: 361.08 },
    { min: 8_137, max: 12_431, subtract: 8_137, rate: 0.064, base: 527.23 },
    { min: 12_431, max: 14_354, subtract: 12_431, rate: 0.1349, base: 802.08 },
    { min: 14_354, max: 41_444, subtract: 14_354, rate: 0.0735, base: 1_061.54 },
    { min: 41_444, max: 82_898, subtract: 41_444, rate: 0.0765, base: 3_052.65 },
    { min: 82_898, max: null, subtract: 82_898, rate: 0.109, base: 6_224.54 },
  ],
  "semi-monthly": [
    { min: 0, max: 354, subtract: 0, rate: 0.039, base: 0 },
    { min: 354, max: 488, subtract: 354, rate: 0.044, base: 13.83 },
    { min: 488, max: 579, subtract: 488, rate: 0.0515, base: 19.67 },
    { min: 579, max: 3_360, subtract: 579, rate: 0.054, base: 24.42 },
    { min: 3_360, max: 4_033, subtract: 3_360, rate: 0.059, base: 174.58 },
    { min: 4_033, max: 4_485, subtract: 4_033, rate: 0.0657, base: 214.29 },
    { min: 4_485, max: 6_569, subtract: 4_485, rate: 0.0707, base: 243.96 },
    { min: 6_569, max: 8_815, subtract: 6_569, rate: 0.0801, base: 391.17 },
    { min: 8_815, max: 13_467, subtract: 8_815, rate: 0.064, base: 571.17 },
    { min: 13_467, max: 15_550, subtract: 13_467, rate: 0.1349, base: 868.92 },
    { min: 15_550, max: 44_898, subtract: 15_550, rate: 0.0735, base: 1_150 },
    { min: 44_898, max: 89_806, subtract: 44_898, rate: 0.0765, base: 3_307.04 },
    { min: 89_806, max: null, subtract: 89_806, rate: 0.109, base: 6_742.49 },
  ],
  monthly: [
    { min: 0, max: 708, subtract: 0, rate: 0.039, base: 0 },
    { min: 708, max: 975, subtract: 708, rate: 0.044, base: 27.67 },
    { min: 975, max: 1_158, subtract: 975, rate: 0.0515, base: 39.33 },
    { min: 1_158, max: 6_721, subtract: 1_158, rate: 0.054, base: 48.83 },
    { min: 6_721, max: 8_067, subtract: 6_721, rate: 0.059, base: 349.17 },
    { min: 8_067, max: 8_971, subtract: 8_067, rate: 0.0657, base: 428.58 },
    { min: 8_971, max: 13_138, subtract: 8_971, rate: 0.0707, base: 487.92 },
    { min: 13_138, max: 17_629, subtract: 13_138, rate: 0.0801, base: 782.33 },
    { min: 17_629, max: 26_933, subtract: 17_629, rate: 0.064, base: 1_142.33 },
    { min: 26_933, max: 31_100, subtract: 26_933, rate: 0.1349, base: 1_737.83 },
    { min: 31_100, max: 89_796, subtract: 31_100, rate: 0.0735, base: 2_300 },
    { min: 89_796, max: 179_613, subtract: 89_796, rate: 0.0765, base: 6_614.08 },
    { min: 179_613, max: null, subtract: 179_613, rate: 0.109, base: 13_484.08 },
  ],
  annual: [
    { min: 0, max: 8_500, subtract: 0, rate: 0.039, base: 0 },
    { min: 8_500, max: 11_700, subtract: 8_500, rate: 0.044, base: 332 },
    { min: 11_700, max: 13_900, subtract: 11_700, rate: 0.0515, base: 472 },
    { min: 13_900, max: 80_650, subtract: 13_900, rate: 0.054, base: 586 },
    { min: 80_650, max: 96_800, subtract: 80_650, rate: 0.059, base: 4_190 },
    { min: 96_800, max: 107_650, subtract: 96_800, rate: 0.0657, base: 5_143 },
    { min: 107_650, max: 157_650, subtract: 107_650, rate: 0.0707, base: 5_855 },
    { min: 157_650, max: 211_550, subtract: 157_650, rate: 0.0801, base: 9_388 },
    { min: 211_550, max: 323_200, subtract: 211_550, rate: 0.064, base: 13_708 },
    { min: 323_200, max: 373_200, subtract: 323_200, rate: 0.1349, base: 20_854 },
    { min: 373_200, max: 1_077_550, subtract: 373_200, rate: 0.0735, base: 27_600 },
    { min: 1_077_550, max: 2_155_350, subtract: 1_077_550, rate: 0.0765, base: 79_369 },
    { min: 2_155_350, max: null, subtract: 2_155_350, rate: 0.109, base: 161_833.2 },
  ],
}

const SINGLE_TOP_RATE_BANDS: NewYorkTopRateBand[] = [
  { min: 1_077_550, max: 5_000_000, rate: 0.1045 },
  { min: 5_000_000, max: 25_000_000, rate: 0.111 },
  { min: 25_000_000, max: null, rate: 0.117 },
]

const MARRIED_TOP_RATE_BANDS: NewYorkTopRateBand[] = [
  { min: 2_155_350, max: 5_000_000, rate: 0.1045 },
  { min: 5_000_000, max: 25_000_000, rate: 0.111 },
  { min: 25_000_000, max: null, rate: 0.117 },
]

function getPeriodsPerYear(freq: NewYorkPayrollFrequency): number {
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

function getMaritalBucket(filingStatus: FilingStatus): "single" | "married" {
  return filingStatus === "marriedJoint" || filingStatus === "marriedSeparate"
    ? "married"
    : "single"
}

function getNewYorkTables(filingStatus: FilingStatus) {
  return getMaritalBucket(filingStatus) === "married"
    ? { exact: MARRIED_EXACT_TABLES, top: MARRIED_TOP_RATE_BANDS }
    : { exact: SINGLE_EXACT_TABLES, top: SINGLE_TOP_RATE_BANDS }
}

function calculateBracketTax(netWages: number, brackets: NewYorkBracket[]): number {
  const row = brackets.find(
    (candidate) => netWages >= candidate.min && (candidate.max == null || netWages < candidate.max)
  )

  if (!row) {
    return 0
  }

  return d(netWages)
    .sub(row.subtract)
    .mul(row.rate)
    .add(row.base)
    .toDecimalPlaces(2)
    .toNumber()
}

function calculateTopRateTax(
  netWages: number,
  payFrequency: NewYorkPayrollFrequency,
  topRateBands: NewYorkTopRateBand[]
): number {
  const periods = getPeriodsPerYear(payFrequency)
  const annualizedWages = d(netWages).mul(periods).toNumber()
  const band = topRateBands.find(
    (candidate) =>
      annualizedWages >= candidate.min &&
      (candidate.max == null || annualizedWages < candidate.max)
  )

  if (!band) {
    return 0
  }

  return d(annualizedWages)
    .mul(band.rate)
    .div(periods)
    .toDecimalPlaces(2)
    .toNumber()
}

export function isNewYorkWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    primaryState === "NewYork" ||
    residenceState === "NewYork" ||
    workState === "NewYork"
  )
}

export function calculateNewYorkWithholding(profile: {
  taxableIncome: number
  filingStatus: FilingStatus
  payFrequency: NewYorkPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
  multiStateWorker?: boolean
  newYorkWithholdingExemptions?: number
  newYorkAdditionalStateWithholding?: number
  newYorkExempt?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isResident = residenceState === "NewYork"
  const worksInNewYork = workState === "NewYork"

  if (!isResident && !worksInNewYork && primaryState !== "NewYork") {
    return 0
  }

  if (profile.newYorkExempt) {
    return 0
  }

  const maritalBucket = getMaritalBucket(profile.filingStatus)
  const deductionAllowance = NEW_YORK_DEDUCTION_ALLOWANCE[maritalBucket][profile.payFrequency]
  const exemptionAllowance =
    NEW_YORK_EXEMPTION_VALUE[profile.payFrequency] *
    (profile.newYorkWithholdingExemptions ?? 0)
  const netWages = clampNonNegative(
    d(profile.taxableIncome).sub(deductionAllowance).sub(exemptionAllowance)
  ).toNumber()
  const tables = getNewYorkTables(profile.filingStatus)
  const exactTax = calculateBracketTax(netWages, tables.exact[profile.payFrequency])
  const withholding =
    exactTax > 0 ? exactTax : calculateTopRateTax(netWages, profile.payFrequency, tables.top)

  return d(withholding)
    .add(profile.newYorkAdditionalStateWithholding ?? 0)
    .toDecimalPlaces(2)
    .toNumber()
}

export const newYorkStrategy: StateTaxStrategy = {
  stateCode: "NewYork",
  applies: (context) => isNewYorkWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (residenceState === "NewYork" && workState !== "NewYork") {
      warnings.push(
        "New York resident wages earned in another taxing jurisdiction can require reducing New York withholding by the other jurisdiction's payroll withholding, and that resident-credit coordination is not fully modeled here."
      )
    }

    if (residenceState !== "NewYork" && workState === "NewYork" && context.multiStateWorker) {
      warnings.push(
        "New York nonresident multistate withholding can require Form IT-2104.1 allocation of only New York-source wages. This calculator treats the current paycheck's taxable wages as fully New York-source unless you manually adjust the wage base."
      )
    }

    if (context.profile.newYorkWithholdingExemptions == null) {
      warnings.push(
        "New York payroll withholding is more accurate when the IT-2104 withholding allowance count is provided."
      )
    }

    return createStateCalculationResult("New York State NYS-50-T-NYS exact payroll withholding", "dedicated", {
      stateTax: calculateNewYorkWithholding({
        taxableIncome: context.taxableIncome,
        filingStatus: context.filingStatus,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        multiStateWorker: context.multiStateWorker,
        newYorkWithholdingExemptions: context.profile.newYorkWithholdingExemptions,
        newYorkAdditionalStateWithholding: context.profile.newYorkAdditionalStateWithholding,
        newYorkExempt: context.profile.newYorkExempt,
      }),
      warnings,
    })
  },
}
