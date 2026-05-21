import { d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { StateTaxStrategy } from "../types"

const PENNSYLVANIA_STATE_RATE = 0.0307
const PENNSYLVANIA_RECIPROCITY_STATES = new Set([
  "Indiana",
  "Maryland",
  "Ohio",
  "NewJersey",
  "Virginia",
  "WestVirginia",
])

function isPennsylvaniaWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")

  return (
    primaryState === "Pennsylvania" ||
    residenceState === "Pennsylvania" ||
    workState === "Pennsylvania"
  )
}

function calculatePennsylvaniaStateWithholding(profile: {
  taxableIncome: number
  state?: string
  residenceState?: string
  workState?: string
  reciprocityElection?: boolean
}): number {
  if (!isPennsylvaniaWithholdingState(profile)) {
    return 0
  }

  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")

  if (residenceState === "Pennsylvania") {
    return d(profile.taxableIncome).mul(PENNSYLVANIA_STATE_RATE).toDecimalPlaces(2).toNumber()
  }

  if (
    workState === "Pennsylvania" &&
    profile.reciprocityElection &&
    PENNSYLVANIA_RECIPROCITY_STATES.has(residenceState)
  ) {
    return 0
  }

  if (workState === "Pennsylvania") {
    return d(profile.taxableIncome).mul(PENNSYLVANIA_STATE_RATE).toDecimalPlaces(2).toNumber()
  }

  return 0
}

export const pennsylvaniaStrategy: StateTaxStrategy = {
  stateCode: "Pennsylvania",
  applies: (context) => isPennsylvaniaWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (
      residenceState !== "Pennsylvania" &&
      workState === "Pennsylvania" &&
      PENNSYLVANIA_RECIPROCITY_STATES.has(residenceState) &&
      !context.reciprocityElection
    ) {
      warnings.push(
        "Pennsylvania reciprocity for Indiana, Maryland, New Jersey, Ohio, Virginia, and West Virginia residents is only applied here when the reciprocity election is turned on."
      )
    }

    if (residenceState === "Pennsylvania" && workState !== "Pennsylvania") {
      warnings.push(
        "Pennsylvania residents remain subject to Pennsylvania wage withholding even when they work outside Pennsylvania, but the other state's payroll treatment can still require employer-specific coordination."
      )
    }

    return createStateCalculationResult("Pennsylvania flat-rate employer withholding", "dedicated", {
      stateTax: calculatePennsylvaniaStateWithholding({
        taxableIncome: context.taxableIncome,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        reciprocityElection: context.reciprocityElection,
      }),
      warnings,
    })
  },
}
