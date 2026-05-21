import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type IowaPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

const IOWA_RATE = 0.038

const IOWA_DEDUCTION_TABLE: Record<
  IowaPayrollFrequency,
  {
    singleLike: number
    headOfHousehold: number
    marriedSingleEarner: number
  }
> = {
  weekly: {
    singleLike: 250,
    headOfHousehold: 375,
    marriedSingleEarner: 500,
  },
  biweekly: {
    singleLike: 500,
    headOfHousehold: 750,
    marriedSingleEarner: 1_000,
  },
  "semi-monthly": {
    singleLike: 541.67,
    headOfHousehold: 812.5,
    marriedSingleEarner: 1_083.33,
  },
  monthly: {
    singleLike: 1_083.33,
    headOfHousehold: 1_625,
    marriedSingleEarner: 2_166.67,
  },
  annual: {
    singleLike: 13_000,
    headOfHousehold: 19_500,
    marriedSingleEarner: 26_000,
  },
}

function getPeriodsPerYear(freq: IowaPayrollFrequency): number {
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

function getIowaDeduction(
  filingStatus: FilingStatus,
  spouseHasIncome: boolean | undefined,
  payFrequency: IowaPayrollFrequency
): number {
  const row = IOWA_DEDUCTION_TABLE[payFrequency]

  if (filingStatus === "headOfHousehold") {
    return row.headOfHousehold
  }

  if (filingStatus === "marriedJoint" && !spouseHasIncome) {
    return row.marriedSingleEarner
  }

  return row.singleLike
}

export function isIowaWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  if (primaryState) {
    return primaryState === "Iowa"
  }

  return residenceState === "Iowa" || workState === "Iowa"
}

export function calculateIowaWithholding(profile: {
  taxableIncome: number
  payFrequency: IowaPayrollFrequency
  filingStatus: FilingStatus
  state?: string
  residenceState?: string
  workState?: string
  reciprocityElection?: boolean
  iowaAllowanceAmount?: number
  iowaAdditionalWithholding?: number
  iowaExempt?: boolean
  iowaSpouseHasIncome?: boolean
  iowaMilitarySpouseExempt?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isIowaResident = residenceState === "Iowa"
  const worksInIowa = workState === "Iowa"

  if (profile.iowaExempt || profile.iowaMilitarySpouseExempt) {
    return 0
  }

  if (!isIowaResident && !worksInIowa && primaryState !== "Iowa") {
    return 0
  }

  if (
    !isIowaResident &&
    worksInIowa &&
    residenceState === "Illinois" &&
    profile.reciprocityElection === true
  ) {
    return 0
  }

  const deduction = getIowaDeduction(
    profile.filingStatus,
    profile.iowaSpouseHasIncome,
    profile.payFrequency
  )
  const t1 = clampNonNegative(d(profile.taxableIncome).sub(deduction))
  const t2 = t1.mul(IOWA_RATE)
  const t3 = t2.sub(
    d(profile.iowaAllowanceAmount ?? 0).div(getPeriodsPerYear(profile.payFrequency))
  )

  return clampNonNegative(t3)
    .add(profile.iowaAdditionalWithholding ?? 0)
    .toDecimalPlaces(2)
    .toNumber()
}

export const iowaStrategy: StateTaxStrategy = {
  stateCode: "Iowa",
  applies: (context) => isIowaWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (
      residenceState === "Illinois" &&
      workState === "Iowa" &&
      context.reciprocityElection !== true
    ) {
      warnings.push(
        "Illinois residents working in Iowa can be exempt from Iowa withholding if they filed Iowa's nonresidence statement with payroll."
      )
    }

    if (
      context.profile.iowaExempt &&
      residenceState !== "Iowa"
    ) {
      warnings.push(
        "Iowa's regular EXEMPT election is generally available only to Iowa residents with no Iowa tax liability. Nonresidents should not use that election."
      )
    }

    return createStateCalculationResult("Iowa IA W-4 payroll withholding", "dedicated", {
      stateTax: calculateIowaWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        filingStatus: context.filingStatus,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        reciprocityElection: context.reciprocityElection,
        iowaAllowanceAmount: context.profile.iowaAllowanceAmount,
        iowaAdditionalWithholding: context.profile.iowaAdditionalWithholding,
        iowaExempt: context.profile.iowaExempt,
        iowaSpouseHasIncome: context.profile.iowaSpouseHasIncome,
        iowaMilitarySpouseExempt: context.profile.iowaMilitarySpouseExempt,
      }),
      warnings,
    })
  },
}
