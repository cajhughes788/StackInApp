import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type UtahPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

const UTAH_PRIMARY_RATE = 0.045
const UTAH_ALLOWANCE_RATE = 0.013

const UTAH_SCHEDULES: Record<
  UtahPayrollFrequency,
  { single: { baseAllowance: number; threshold: number }; married: { baseAllowance: number; threshold: number } }
> = {
  weekly: {
    single: { baseAllowance: 9, threshold: 175 },
    married: { baseAllowance: 17, threshold: 350 },
  },
  biweekly: {
    single: { baseAllowance: 17, threshold: 350 },
    married: { baseAllowance: 35, threshold: 701 },
  },
  "semi-monthly": {
    single: { baseAllowance: 19, threshold: 379 },
    married: { baseAllowance: 38, threshold: 736 },
  },
  monthly: {
    single: { baseAllowance: 38, threshold: 759 },
    married: { baseAllowance: 75, threshold: 1518 },
  },
  annual: {
    single: { baseAllowance: 450, threshold: 9107 },
    married: { baseAllowance: 900, threshold: 18213 },
  },
}

function getUtahStatusBucket(filingStatus: FilingStatus): "single" | "married" {
  return filingStatus === "marriedJoint" || filingStatus === "marriedSeparate"
    ? "married"
    : "single"
}

export function isUtahWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const state = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return state === "Utah" || residenceState === "Utah" || workState === "Utah"
}

export function calculateUtahWithholding(profile: {
  taxableIncome: number
  filingStatus: FilingStatus
  payFrequency: UtahPayrollFrequency
  state?: string
  residenceState?: string
  workState?: string
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(
    profile.residenceState ?? profile.state ?? ""
  )
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isUtahResident = residenceState === "Utah"
  const isUtahWork = workState === "Utah"

  if (!isUtahResident && !isUtahWork && primaryState !== "Utah") {
    return 0
  }

  const statusBucket = getUtahStatusBucket(profile.filingStatus)
  const schedule = UTAH_SCHEDULES[profile.payFrequency][statusBucket]
  const wages = d(profile.taxableIncome)
  const line2 = wages.mul(UTAH_PRIMARY_RATE)
  const reducedWages = clampNonNegative(wages.sub(schedule.threshold))
  const line5 = reducedWages.mul(UTAH_ALLOWANCE_RATE)
  const line6 = clampNonNegative(d(schedule.baseAllowance).sub(line5))

  return clampNonNegative(line2.sub(line6)).toDecimalPlaces(2).toNumber()
}

export const utahStrategy: StateTaxStrategy = {
  stateCode: "Utah",
  applies: (context) => isUtahWithholdingState(context),
  calculate: (context) =>
    createStateCalculationResult("Utah dedicated payroll withholding", "dedicated", {
      stateTax: calculateUtahWithholding({
        taxableIncome: context.taxableIncome,
        filingStatus: context.filingStatus,
        payFrequency: context.payFrequency,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
      }),
    }),
}
