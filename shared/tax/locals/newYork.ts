import { d } from "../math"
import { normalizeStateKey } from "../state"
import { createLocalCalculationResult } from "./strategyUtils"
import type { LocalTaxStrategy, TaxContext, TaxProfileInput } from "../types"

type PayrollFrequency = TaxProfileInput["payFrequency"]
type NycRow = { min: number; max: number | null; subtract: number; rate: number; base: number }
type FrequencyMap = Record<PayrollFrequency, NycRow[]>

const NYC_TABLES: FrequencyMap = {
  weekly: [
    { min: 0, max: 154, subtract: 0, rate: 0.0205, base: 0 },
    { min: 154, max: 167, subtract: 154, rate: 0.028, base: 3.15 },
    { min: 167, max: 288, subtract: 167, rate: 0.0325, base: 3.54 },
    { min: 288, max: 481, subtract: 288, rate: 0.0395, base: 7.46 },
    { min: 481, max: 1154, subtract: 481, rate: 0.0415, base: 15.06 },
    { min: 1154, max: null, subtract: 1154, rate: 0.0425, base: 43 },
  ],
  biweekly: [
    { min: 0, max: 308, subtract: 0, rate: 0.0205, base: 0 },
    { min: 308, max: 334, subtract: 308, rate: 0.028, base: 6.31 },
    { min: 334, max: 577, subtract: 334, rate: 0.0325, base: 7.08 },
    { min: 577, max: 962, subtract: 577, rate: 0.0395, base: 14.92 },
    { min: 962, max: 2308, subtract: 962, rate: 0.0415, base: 30.12 },
    { min: 2308, max: null, subtract: 2308, rate: 0.0425, base: 86 },
  ],
  "semi-monthly": [
    { min: 0, max: 333, subtract: 0, rate: 0.0205, base: 0 },
    { min: 333, max: 362, subtract: 333, rate: 0.028, base: 6.83 },
    { min: 362, max: 625, subtract: 362, rate: 0.0325, base: 7.67 },
    { min: 625, max: 1042, subtract: 625, rate: 0.0395, base: 16.17 },
    { min: 1042, max: 2500, subtract: 1042, rate: 0.0415, base: 32.63 },
    { min: 2500, max: null, subtract: 2500, rate: 0.0425, base: 93.17 },
  ],
  monthly: [
    { min: 0, max: 667, subtract: 0, rate: 0.0205, base: 0 },
    { min: 667, max: 725, subtract: 667, rate: 0.028, base: 13.67 },
    { min: 725, max: 1250, subtract: 725, rate: 0.0325, base: 15.33 },
    { min: 1250, max: 2083, subtract: 1250, rate: 0.0395, base: 32.33 },
    { min: 2083, max: 5000, subtract: 2083, rate: 0.0415, base: 65.25 },
    { min: 5000, max: null, subtract: 5000, rate: 0.0425, base: 186.33 },
  ],
  annual: [
    { min: 0, max: 8000, subtract: 0, rate: 0.0205, base: 0 },
    { min: 8000, max: 8700, subtract: 8000, rate: 0.028, base: 164 },
    { min: 8700, max: 15000, subtract: 8700, rate: 0.0325, base: 184 },
    { min: 15000, max: 25000, subtract: 15000, rate: 0.0395, base: 388 },
    { min: 25000, max: 60000, subtract: 25000, rate: 0.0415, base: 783 },
    { min: 60000, max: null, subtract: 60000, rate: 0.0425, base: 2236 },
  ],
}

const NYC_DEDUCTION_ALLOWANCE = {
  single: {
    weekly: 96.15,
    biweekly: 192.3,
    "semi-monthly": 208.35,
    monthly: 416.7,
    annual: 5000,
  },
  married: {
    weekly: 105.75,
    biweekly: 211.5,
    "semi-monthly": 229.15,
    monthly: 458.3,
    annual: 5500,
  },
} as const

const NYC_EXEMPTION_VALUE = {
  weekly: 19.25,
  biweekly: 38.5,
  "semi-monthly": 41.65,
  monthly: 83.3,
  annual: 1000,
} as const

const YONKERS_NONRESIDENT_EXCLUSION = {
  weekly: [
    { min: 0, max: 59, exclusion: 0 },
    { min: 59, max: 154, exclusion: 59 },
    { min: 154, max: 192, exclusion: 154 },
    { min: 192, max: 385, exclusion: 192 },
    { min: 385, max: 1154, exclusion: 385 },
    { min: 1154, max: null, exclusion: 1154 },
  ],
  biweekly: [
    { min: 0, max: 117, exclusion: 0 },
    { min: 117, max: 308, exclusion: 117 },
    { min: 308, max: 385, exclusion: 308 },
    { min: 385, max: 769, exclusion: 385 },
    { min: 769, max: 2308, exclusion: 769 },
    { min: 2308, max: null, exclusion: 2308 },
  ],
  "semi-monthly": [
    { min: 0, max: 125, exclusion: 0 },
    { min: 125, max: 333, exclusion: 125 },
    { min: 333, max: 417, exclusion: 333 },
    { min: 417, max: 833, exclusion: 417 },
    { min: 833, max: 2500, exclusion: 833 },
    { min: 2500, max: null, exclusion: 2500 },
  ],
  monthly: [
    { min: 0, max: 250, exclusion: 0 },
    { min: 250, max: 667, exclusion: 250 },
    { min: 667, max: 833, exclusion: 667 },
    { min: 833, max: 1667, exclusion: 833 },
    { min: 1667, max: 5000, exclusion: 1667 },
    { min: 5000, max: null, exclusion: 5000 },
  ],
  annual: [
    { min: 0, max: 3000, exclusion: 0 },
    { min: 3000, max: 8000, exclusion: 3000 },
    { min: 8000, max: 10000, exclusion: 8000 },
    { min: 10000, max: 20000, exclusion: 10000 },
    { min: 20000, max: 60000, exclusion: 20000 },
    { min: 60000, max: null, exclusion: 60000 },
  ],
} as const

const YONKERS_RESIDENT_TABLES = {
  single: {
    weekly: [
      { min: 0, max: 163, subtract: 0, rate: 0.039, base: 0 },
      { min: 163, max: 225, subtract: 163, rate: 0.044, base: 6.38 },
      { min: 225, max: 267, subtract: 225, rate: 0.0515, base: 9.08 },
      { min: 267, max: 1551, subtract: 267, rate: 0.054, base: 11.27 },
      { min: 1551, max: 1862, subtract: 1551, rate: 0.059, base: 80.58 },
      { min: 1862, max: 2070, subtract: 1862, rate: 0.0703, base: 98.9 },
      { min: 2070, max: 3032, subtract: 2070, rate: 0.0753, base: 113.58 },
      { min: 3032, max: 4142, subtract: 3032, rate: 0.064, base: 186.02 },
      { min: 4142, max: 5104, subtract: 4142, rate: 0.1144, base: 257.1 },
      { min: 5104, max: 20722, subtract: 5104, rate: 0.0735, base: 367.13 },
      { min: 20722, max: null, subtract: 20722, rate: 0.0765, base: 1511.05 },
    ],
    biweekly: [
      { min: 0, max: 327, subtract: 0, rate: 0.039, base: 0 },
      { min: 327, max: 450, subtract: 327, rate: 0.044, base: 12.77 },
      { min: 450, max: 535, subtract: 450, rate: 0.0515, base: 18.15 },
      { min: 535, max: 3102, subtract: 535, rate: 0.054, base: 22.54 },
      { min: 3102, max: 3723, subtract: 3102, rate: 0.059, base: 161.15 },
      { min: 3723, max: 4140, subtract: 3723, rate: 0.0703, base: 197.81 },
      { min: 4140, max: 6063, subtract: 4140, rate: 0.0753, base: 227.13 },
      { min: 6063, max: 8085, subtract: 6063, rate: 0.064, base: 371.94 },
      { min: 8085, max: 10208, subtract: 8085, rate: 0.1144, base: 501.35 },
      { min: 10208, max: 41444, subtract: 10208, rate: 0.0735, base: 744.22 },
      { min: 41444, max: null, subtract: 41444, rate: 0.0765, base: 3040.42 },
    ],
    "semi-monthly": [
      { min: 0, max: 354, subtract: 0, rate: 0.039, base: 0 },
      { min: 354, max: 488, subtract: 354, rate: 0.044, base: 13.83 },
      { min: 488, max: 579, subtract: 488, rate: 0.0515, base: 19.67 },
      { min: 579, max: 3360, subtract: 579, rate: 0.054, base: 24.42 },
      { min: 3360, max: 4033, subtract: 3360, rate: 0.059, base: 174.58 },
      { min: 4033, max: 4485, subtract: 4033, rate: 0.0703, base: 214.29 },
      { min: 4485, max: 6569, subtract: 4485, rate: 0.0753, base: 246.08 },
      { min: 6569, max: 8975, subtract: 6569, rate: 0.064, base: 403.04 },
      { min: 8975, max: 11058, subtract: 8975, rate: 0.1144, base: 557.04 },
      { min: 11058, max: 44898, subtract: 11058, rate: 0.0735, base: 795.46 },
      { min: 44898, max: null, subtract: 44898, rate: 0.0765, base: 3282.22 },
    ],
    monthly: [
      { min: 0, max: 708, subtract: 0, rate: 0.039, base: 0 },
      { min: 708, max: 975, subtract: 708, rate: 0.044, base: 27.67 },
      { min: 975, max: 1158, subtract: 975, rate: 0.0515, base: 39.33 },
      { min: 1158, max: 6721, subtract: 1158, rate: 0.054, base: 48.83 },
      { min: 6721, max: 8067, subtract: 6721, rate: 0.059, base: 349.17 },
      { min: 8067, max: 8971, subtract: 8067, rate: 0.0703, base: 428.58 },
      { min: 8971, max: 13138, subtract: 8971, rate: 0.0753, base: 492.17 },
      { min: 13138, max: 17950, subtract: 13138, rate: 0.064, base: 806.08 },
      { min: 17950, max: 22117, subtract: 17950, rate: 0.1144, base: 1114.08 },
      { min: 22117, max: 89796, subtract: 22117, rate: 0.0735, base: 1590.92 },
      { min: 89796, max: null, subtract: 89796, rate: 0.0765, base: 6866.08 },
    ],
    annual: [
      { min: 0, max: 8500, subtract: 0, rate: 0.039, base: 0 },
      { min: 8500, max: 11700, subtract: 8500, rate: 0.044, base: 332 },
      { min: 11700, max: 13900, subtract: 11700, rate: 0.0515, base: 472 },
      { min: 13900, max: 80650, subtract: 13900, rate: 0.054, base: 586 },
      { min: 80650, max: 96800, subtract: 80650, rate: 0.059, base: 4190 },
      { min: 96800, max: 107650, subtract: 96800, rate: 0.0703, base: 5143 },
      { min: 107650, max: 157650, subtract: 107650, rate: 0.0753, base: 5906 },
      { min: 157650, max: 215400, subtract: 157650, rate: 0.064, base: 9673 },
      { min: 215400, max: 265400, subtract: 215400, rate: 0.1144, base: 13369 },
      { min: 265400, max: 1077550, subtract: 265400, rate: 0.0735, base: 19091 },
      { min: 1077550, max: null, subtract: 1077550, rate: 0.0765, base: 78793.03 },
    ],
  },
  married: {
    weekly: [
      { min: 0, max: 163, subtract: 0, rate: 0.039, base: 0 },
      { min: 163, max: 225, subtract: 163, rate: 0.044, base: 6.38 },
      { min: 225, max: 267, subtract: 225, rate: 0.0515, base: 9.08 },
      { min: 267, max: 1551, subtract: 267, rate: 0.054, base: 11.27 },
      { min: 1551, max: 1862, subtract: 1551, rate: 0.059, base: 80.58 },
      { min: 1862, max: 2070, subtract: 1862, rate: 0.0657, base: 98.9 },
      { min: 2070, max: 3032, subtract: 2070, rate: 0.0707, base: 112.6 },
      { min: 3032, max: 4068, subtract: 3032, rate: 0.0801, base: 180.54 },
      { min: 4068, max: 6215, subtract: 4068, rate: 0.064, base: 263.62 },
      { min: 6215, max: 7177, subtract: 6215, rate: 0.1349, base: 401.04 },
      { min: 7177, max: 20722, subtract: 7177, rate: 0.0735, base: 530.77 },
      { min: 20722, max: 41449, subtract: 20722, rate: 0.0765, base: 1526.33 },
      { min: 41449, max: null, subtract: 41449, rate: 0.109, base: 3112.02 },
    ],
    biweekly: [
      { min: 0, max: 327, subtract: 0, rate: 0.039, base: 0 },
      { min: 327, max: 450, subtract: 327, rate: 0.044, base: 12.77 },
      { min: 450, max: 535, subtract: 450, rate: 0.0515, base: 18.15 },
      { min: 535, max: 3102, subtract: 535, rate: 0.054, base: 22.54 },
      { min: 3102, max: 3723, subtract: 3102, rate: 0.059, base: 161.15 },
      { min: 3723, max: 4140, subtract: 3723, rate: 0.0657, base: 197.81 },
      { min: 4140, max: 6063, subtract: 4140, rate: 0.0707, base: 225.19 },
      { min: 6063, max: 8137, subtract: 6063, rate: 0.0801, base: 361.08 },
      { min: 8137, max: 12431, subtract: 8137, rate: 0.064, base: 527.23 },
      { min: 12431, max: 14354, subtract: 12431, rate: 0.1349, base: 802.08 },
      { min: 14354, max: 41444, subtract: 14354, rate: 0.0735, base: 1061.54 },
      { min: 41444, max: 82898, subtract: 41444, rate: 0.0765, base: 3052.65 },
      { min: 82898, max: null, subtract: 82898, rate: 0.109, base: 6224.54 },
    ],
    "semi-monthly": [
      { min: 0, max: 354, subtract: 0, rate: 0.039, base: 0 },
      { min: 354, max: 488, subtract: 354, rate: 0.044, base: 13.83 },
      { min: 488, max: 579, subtract: 488, rate: 0.0515, base: 19.67 },
      { min: 579, max: 3360, subtract: 579, rate: 0.054, base: 24.42 },
      { min: 3360, max: 4033, subtract: 3360, rate: 0.059, base: 174.58 },
      { min: 4033, max: 4485, subtract: 4033, rate: 0.0657, base: 214.29 },
      { min: 4485, max: 6569, subtract: 4485, rate: 0.0707, base: 243.96 },
      { min: 6569, max: 8815, subtract: 6569, rate: 0.0801, base: 391.17 },
      { min: 8815, max: 13467, subtract: 8815, rate: 0.064, base: 571.17 },
      { min: 13467, max: 15550, subtract: 13467, rate: 0.1349, base: 868.92 },
      { min: 15550, max: 44898, subtract: 15550, rate: 0.0735, base: 1150 },
      { min: 44898, max: 89806, subtract: 44898, rate: 0.0765, base: 3307.04 },
      { min: 89806, max: null, subtract: 89806, rate: 0.109, base: 6742.49 },
    ],
    monthly: [
      { min: 0, max: 708, subtract: 0, rate: 0.039, base: 0 },
      { min: 708, max: 975, subtract: 708, rate: 0.044, base: 27.67 },
      { min: 975, max: 1158, subtract: 975, rate: 0.0515, base: 39.33 },
      { min: 1158, max: 6721, subtract: 1158, rate: 0.054, base: 48.83 },
      { min: 6721, max: 8067, subtract: 6721, rate: 0.059, base: 349.17 },
      { min: 8067, max: 8971, subtract: 8067, rate: 0.0657, base: 428.58 },
      { min: 8971, max: 13138, subtract: 8971, rate: 0.0707, base: 487.92 },
      { min: 13138, max: 17629, subtract: 13138, rate: 0.0801, base: 782.33 },
      { min: 17629, max: 26933, subtract: 17629, rate: 0.064, base: 1142.33 },
      { min: 26933, max: 31100, subtract: 26933, rate: 0.1349, base: 1737.83 },
      { min: 31100, max: 89796, subtract: 31100, rate: 0.0735, base: 2300 },
      { min: 89796, max: 179613, subtract: 89796, rate: 0.0765, base: 6614.08 },
      { min: 179613, max: null, subtract: 179613, rate: 0.109, base: 13484.08 },
    ],
    annual: [
      { min: 0, max: 8500, subtract: 0, rate: 0.039, base: 0 },
      { min: 8500, max: 11700, subtract: 8500, rate: 0.044, base: 332 },
      { min: 11700, max: 13900, subtract: 11700, rate: 0.0515, base: 472 },
      { min: 13900, max: 80650, subtract: 13900, rate: 0.054, base: 586 },
      { min: 80650, max: 96800, subtract: 80650, rate: 0.059, base: 4190 },
      { min: 96800, max: 107650, subtract: 96800, rate: 0.0657, base: 5143 },
      { min: 107650, max: 157650, subtract: 107650, rate: 0.0707, base: 5855 },
      { min: 157650, max: 211550, subtract: 157650, rate: 0.0801, base: 9388 },
      { min: 211550, max: 323200, subtract: 211550, rate: 0.064, base: 13708 },
      { min: 323200, max: 373200, subtract: 323200, rate: 0.1349, base: 20854 },
      { min: 373200, max: 1077550, subtract: 373200, rate: 0.0735, base: 27600 },
      { min: 1077550, max: 2155350, subtract: 1077550, rate: 0.0765, base: 79369 },
      { min: 2155350, max: null, subtract: 2155350, rate: 0.109, base: 161833.2 },
    ],
  },
} as const

const YONKERS_DEDUCTION_ALLOWANCE = {
  single: {
    weekly: 142.3,
    biweekly: 284.6,
    "semi-monthly": 308.35,
    monthly: 616.7,
    annual: 7400,
  },
  married: {
    weekly: 152.9,
    biweekly: 305.8,
    "semi-monthly": 331.25,
    monthly: 662.5,
    annual: 7950,
  },
} as const

const YONKERS_EXEMPTION_VALUE = {
  weekly: 19.25,
  biweekly: 38.5,
  "semi-monthly": 41.65,
  monthly: 83.3,
  annual: 1000,
} as const

function getNyMaritalBucket(context: TaxContext): "single" | "married" {
  return context.filingStatus === "marriedJoint" || context.filingStatus === "marriedSeparate"
    ? "married"
    : "single"
}

function getNewYorkStateContext(context: TaxContext) {
  return {
    primaryState: normalizeStateKey(context.state ?? ""),
    residenceState: normalizeStateKey(context.residenceState ?? context.state ?? ""),
    workState: normalizeStateKey(context.workState ?? context.state ?? ""),
    locality: context.newYorkLocality,
  }
}

function calculateNycResidentTax(context: TaxContext): number {
  const marital = getNyMaritalBucket(context)
  const deductionAllowance = NYC_DEDUCTION_ALLOWANCE[marital][context.payFrequency]
  const exemptionAllowance =
    NYC_EXEMPTION_VALUE[context.payFrequency] * (context.newYorkWithholdingExemptions ?? 0)
  const netWages = Math.max(context.taxableIncome - deductionAllowance - exemptionAllowance, 0)
  const row = NYC_TABLES[context.payFrequency].find(
    (candidate) => netWages >= candidate.min && (candidate.max == null || netWages < candidate.max)
  )

  if (!row) {
    return 0
  }

  return d(netWages - row.subtract)
    .mul(row.rate)
    .add(row.base)
    .toDecimalPlaces(2)
    .toNumber()
}

function calculateYonkersNonresidentTax(context: TaxContext): number {
  const wages = context.taxableIncome
  const row = YONKERS_NONRESIDENT_EXCLUSION[context.payFrequency].find(
    (candidate) => wages >= candidate.min && (candidate.max == null || wages < candidate.max)
  )

  if (!row || row.min === 0) {
    return 0
  }

  return d(Math.max(wages - row.exclusion, 0))
    .mul(0.005)
    .toDecimalPlaces(2)
    .toNumber()
}

function calculateYonkersResidentTax(context: TaxContext): number {
  const marital = getNyMaritalBucket(context)
  const deductionAllowance =
    YONKERS_DEDUCTION_ALLOWANCE[marital][context.payFrequency]
  const exemptionAllowance =
    YONKERS_EXEMPTION_VALUE[context.payFrequency] *
    (context.newYorkWithholdingExemptions ?? 0)
  const netWages = Math.max(context.taxableIncome - deductionAllowance - exemptionAllowance, 0)
  const row = YONKERS_RESIDENT_TABLES[marital][context.payFrequency].find(
    (candidate) => netWages >= candidate.min && (candidate.max == null || netWages < candidate.max)
  )

  if (!row) {
    return 0
  }

  return d(netWages - row.subtract)
    .mul(row.rate)
    .add(row.base)
    .mul(0.1675)
    .toDecimalPlaces(2)
    .toNumber()
}

export function calculateNewYorkLocalTax(context: TaxContext): number {
  const { primaryState, residenceState, workState, locality } = getNewYorkStateContext(context)

  if (
    primaryState !== "NewYork" &&
    residenceState !== "NewYork" &&
    workState !== "NewYork"
  ) {
    return 0
  }

  switch (locality) {
    case "new_york_city_resident":
      return calculateNycResidentTax(context)
    case "yonkers_resident":
      return calculateYonkersResidentTax(context)
    case "yonkers_nonresident":
      return calculateYonkersNonresidentTax(context)
    default:
      return 0
  }
}

export const newYorkLocalStrategy: LocalTaxStrategy = {
  jurisdictionCode: "NewYork",
  applies: (context) => {
    const { primaryState, residenceState, workState } = getNewYorkStateContext(context)
    return (
      primaryState === "NewYork" ||
      residenceState === "NewYork" ||
      workState === "NewYork"
    )
  },
  calculate: (context) => {
    const { locality } = getNewYorkStateContext(context)
    const warnings: string[] = []

    if (!locality) {
      warnings.push(
        "New York local withholding needs a locality selection for New York City or Yonkers when local withholding applies."
      )
    } else if (
      (locality === "new_york_city_resident" || locality === "yonkers_resident") &&
      context.newYorkWithholdingExemptions == null
    ) {
      warnings.push(
        "New York local resident withholding is more accurate when the New York withholding exemption count is provided."
      )
    }

    return createLocalCalculationResult("New York local payroll withholding", {
      localTax: calculateNewYorkLocalTax(context),
      warnings,
    })
  },
}
