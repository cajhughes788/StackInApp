import { d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { StateTaxStrategy, TaxProfileInput } from "../types"

type ArizonaPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

const ARIZONA_DEFAULT_RATE = 0.02

export function isArizonaWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const state = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    state === "Arizona" ||
    residenceState === "Arizona" ||
    workState === "Arizona"
  )
}

function toRateDecimal(percent?: number): number {
  return percent != null ? percent / 100 : ARIZONA_DEFAULT_RATE
}

export function calculateArizonaWithholding(profile: {
  taxableIncome: number
  state?: string
  residenceState?: string
  workState?: string
  arizonaWithholdingPercent?: number
  arizonaExempt?: boolean
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const isArizonaResident = residenceState === "Arizona"
  const worksInArizona = workState === "Arizona"

  if (profile.arizonaExempt) {
    return 0
  }

  if (!worksInArizona && !(isArizonaResident && primaryState === "Arizona")) {
    return 0
  }

  return d(profile.taxableIncome)
    .mul(toRateDecimal(profile.arizonaWithholdingPercent))
    .toDecimalPlaces(2)
    .toNumber()
}

export const arizonaStrategy: StateTaxStrategy = {
  stateCode: "Arizona",
  applies: (context) => isArizonaWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (residenceState === "Arizona" && workState !== "Arizona" && context.state !== "Arizona") {
      warnings.push(
        "Arizona residents working outside Arizona generally need a separate A-4V voluntary election if they want Arizona withholding from out-of-state wages."
      )
    }

    if (residenceState !== "Arizona" && workState === "Arizona") {
      warnings.push(
        "Arizona nonresident withholding can depend on the 60-day Arizona work threshold or a specific nonresident exemption; this calculator assumes Arizona withholding applies to this paycheck."
      )
    }

    return createStateCalculationResult("Arizona A-4 percentage withholding", "dedicated", {
      stateTax: calculateArizonaWithholding({
        taxableIncome: context.taxableIncome,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        arizonaWithholdingPercent: context.profile.arizonaWithholdingPercent,
        arizonaExempt: context.profile.arizonaExempt,
      }),
      warnings,
    })
  },
}
