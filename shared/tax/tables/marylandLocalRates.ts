import type { FilingStatus } from "../types"

export type MarylandLocalRateConfig =
  | { type: "flat"; rate: number }
  | {
      type: "graduated"
      single: Array<{ upTo: number | null; rate: number }>
      joint: Array<{ upTo: number | null; rate: number }>
    }

export const MARYLAND_NONRESIDENT_LOCAL_RATE = 0.0225

export const MARYLAND_LOCAL_RATES: Record<string, MarylandLocalRateConfig> = {
  allegany: { type: "flat", rate: 0.0303 },
  annearundel: {
    type: "graduated",
    single: [
      { upTo: 50000, rate: 0.027 },
      { upTo: 400000, rate: 0.0294 },
      { upTo: null, rate: 0.032 },
    ],
    joint: [
      { upTo: 75000, rate: 0.027 },
      { upTo: 480000, rate: 0.0294 },
      { upTo: null, rate: 0.032 },
    ],
  },
  baltimore: { type: "flat", rate: 0.032 },
  baltimorecity: { type: "flat", rate: 0.032 },
  calvert: { type: "flat", rate: 0.032 },
  caroline: { type: "flat", rate: 0.032 },
  carroll: { type: "flat", rate: 0.0303 },
  cecil: { type: "flat", rate: 0.0274 },
  charles: { type: "flat", rate: 0.0303 },
  dorchester: { type: "flat", rate: 0.032 },
  frederick: {
    type: "graduated",
    single: [
      { upTo: 25000, rate: 0.0225 },
      { upTo: 100000, rate: 0.0275 },
      { upTo: 250000, rate: 0.0296 },
      { upTo: null, rate: 0.032 },
    ],
    joint: [
      { upTo: 25000, rate: 0.0225 },
      { upTo: 100000, rate: 0.0275 },
      { upTo: 250000, rate: 0.0296 },
      { upTo: null, rate: 0.032 },
    ],
  },
  garrett: { type: "flat", rate: 0.0265 },
  harford: { type: "flat", rate: 0.0306 },
  howard: { type: "flat", rate: 0.032 },
  kent: { type: "flat", rate: 0.032 },
  montgomery: { type: "flat", rate: 0.032 },
  princegeorges: { type: "flat", rate: 0.032 },
  queenannes: { type: "flat", rate: 0.032 },
  somerset: { type: "flat", rate: 0.032 },
  stmarys: { type: "flat", rate: 0.032 },
  talbot: { type: "flat", rate: 0.024 },
  washington: { type: "flat", rate: 0.0295 },
  wicomico: { type: "flat", rate: 0.032 },
  worcester: { type: "flat", rate: 0.0225 },
}

const JOINT_LOCAL_RATE_STATUSES: FilingStatus[] = [
  "marriedJoint",
  "headOfHousehold",
]

export function normalizeMarylandCountyKey(raw?: string | null): string {
  if (!raw) return ""

  return raw
    .toLowerCase()
    .replace(/\bcounty\b/g, "")
    .replace(/\bcity\b/g, "city")
    .replace(/[^a-z]/g, "")
}

export function getMarylandLocalRate(
  county: string | undefined,
  filingStatus: FilingStatus,
  annualTaxableIncome: number
): number | null {
  const normalizedCounty = normalizeMarylandCountyKey(county)
  const config = MARYLAND_LOCAL_RATES[normalizedCounty]

  if (!config) return null

  if (config.type === "flat") {
    return config.rate
  }

  const brackets = JOINT_LOCAL_RATE_STATUSES.includes(filingStatus)
    ? config.joint
    : config.single

  for (const bracket of brackets) {
    if (bracket.upTo == null || annualTaxableIncome <= bracket.upTo) {
      return bracket.rate
    }
  }

  return brackets[brackets.length - 1]?.rate ?? null
}
