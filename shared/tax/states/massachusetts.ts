import { clampNonNegative, d } from "../math"
import { normalizeStateKey } from "../state"
import { createStateCalculationResult } from "./strategyUtils"
import type { FilingStatus, StateTaxStrategy, TaxProfileInput } from "../types"

type MassachusettsPayrollFrequency = Extract<
  TaxProfileInput["payFrequency"],
  "weekly" | "biweekly" | "semi-monthly" | "monthly" | "annual"
>

const MASSACHUSETTS_RATE = 0.05
const MASSACHUSETTS_SURTAX_RATE = 0.04
const MASSACHUSETTS_2026_SURTAX_THRESHOLD = 1_107_750
const MASSACHUSETTS_STUDENT_EXEMPT_INCOME_CAP = 8_000

const MASSACHUSETTS_EXEMPTION_VALUES: Record<MassachusettsPayrollFrequency, { perExemption: number; base: number }> = {
  weekly: { perExemption: 19, base: 66 },
  biweekly: { perExemption: 38, base: 131 },
  "semi-monthly": { perExemption: 42, base: 141 },
  monthly: { perExemption: 83, base: 284 },
  annual: { perExemption: 1000, base: 3400 },
}

const MASSACHUSETTS_HEAD_OF_HOUSEHOLD_REDUCTION: Record<MassachusettsPayrollFrequency, number> = {
  weekly: 2.31,
  biweekly: 4.62,
  "semi-monthly": 5.0,
  monthly: 10.0,
  annual: 120.0,
}

const MASSACHUSETTS_BLINDNESS_REDUCTION: Record<MassachusettsPayrollFrequency, number> = {
  weekly: 2.12,
  biweekly: 4.23,
  "semi-monthly": 4.58,
  monthly: 9.17,
  annual: 110.0,
}

function getPeriodsPerYear(freq: MassachusettsPayrollFrequency): number {
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

function getMassachusettsSourceWagesPerPayPeriod(profile: {
  taxableIncome: number
  state?: string
  residenceState?: string
  workState?: string
}): number {
  const primaryState = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")

  if (residenceState === "Massachusetts" || primaryState === "Massachusetts" || workState === "Massachusetts") {
    return profile.taxableIncome
  }

  return 0
}

export function isMassachusettsWithholdingState(profile: {
  state?: string
  residenceState?: string
  workState?: string
}): boolean {
  const state = normalizeStateKey(profile.state ?? "")
  const residenceState = normalizeStateKey(profile.residenceState ?? "")
  const workState = normalizeStateKey(profile.workState ?? "")

  return (
    state === "Massachusetts" ||
    residenceState === "Massachusetts" ||
    workState === "Massachusetts"
  )
}

export function calculateMassachusettsWithholding(profile: {
  taxableIncome: number
  payFrequency: MassachusettsPayrollFrequency
  filingStatus: FilingStatus
  state?: string
  residenceState?: string
  workState?: string
  massachusettsExemptions?: number
  massachusettsBlindExemptions?: number
  massachusettsFullTimeStudentExempt?: boolean
  massachusettsMsrraExempt?: boolean
  massachusettsAdditionalWithholding?: number
}): number {
  const residenceState = normalizeStateKey(profile.residenceState ?? profile.state ?? "")
  const workState = normalizeStateKey(profile.workState ?? profile.state ?? "")
  const primaryState = normalizeStateKey(profile.state ?? "")
  const isMassachusettsResident = residenceState === "Massachusetts"
  const worksInMassachusetts = workState === "Massachusetts"

  if (!isMassachusettsResident && !worksInMassachusetts && primaryState !== "Massachusetts") {
    return 0
  }

  const sourceWages = getMassachusettsSourceWagesPerPayPeriod(profile)
  const additionalWithholding = profile.massachusettsAdditionalWithholding ?? 0

  if (sourceWages <= 0) {
    return d(additionalWithholding).toDecimalPlaces(2).toNumber()
  }

  const annualizedWages = d(sourceWages).mul(getPeriodsPerYear(profile.payFrequency)).toNumber()

  if (profile.massachusettsMsrraExempt) {
    return 0
  }

  if (
    profile.massachusettsFullTimeStudentExempt &&
    annualizedWages <= MASSACHUSETTS_STUDENT_EXEMPT_INCOME_CAP
  ) {
    return 0
  }

  const exemptionConfig = MASSACHUSETTS_EXEMPTION_VALUES[profile.payFrequency]
  const exemptionAmount =
    (profile.massachusettsExemptions ?? 0) * exemptionConfig.perExemption + exemptionConfig.base
  const perPeriodTaxableWages = clampNonNegative(d(sourceWages).sub(exemptionAmount))
  const annualTaxableWages = perPeriodTaxableWages.mul(getPeriodsPerYear(profile.payFrequency))
  const surtaxAnnual = clampNonNegative(annualTaxableWages.sub(MASSACHUSETTS_2026_SURTAX_THRESHOLD)).mul(
    MASSACHUSETTS_SURTAX_RATE
  )

  let withholding = perPeriodTaxableWages.mul(MASSACHUSETTS_RATE).add(
    surtaxAnnual.div(getPeriodsPerYear(profile.payFrequency))
  )

  if (profile.filingStatus === "headOfHousehold") {
    withholding = withholding.sub(MASSACHUSETTS_HEAD_OF_HOUSEHOLD_REDUCTION[profile.payFrequency])
  }

  withholding = withholding.sub(
    d(profile.massachusettsBlindExemptions ?? 0).mul(
      MASSACHUSETTS_BLINDNESS_REDUCTION[profile.payFrequency]
    )
  )

  return clampNonNegative(withholding.add(additionalWithholding))
    .toDecimalPlaces(2)
    .toNumber()
}

export const massachusettsStrategy: StateTaxStrategy = {
  stateCode: "Massachusetts",
  applies: (context) => isMassachusettsWithholdingState(context),
  calculate: (context) => {
    const residenceState = normalizeStateKey(context.residenceState ?? context.state ?? "")
    const workState = normalizeStateKey(context.workState ?? context.state ?? "")
    const warnings: string[] = []

    if (residenceState === "Massachusetts" && workState !== "Massachusetts") {
      warnings.push(
        "Massachusetts residents working in another taxing jurisdiction can require Massachusetts withholding to be reduced by the other state's withholding. This calculator currently computes the Massachusetts withholding amount before any other-state offset."
      )
    }

    if (
      residenceState !== "Massachusetts" &&
      workState === "Massachusetts" &&
      context.multiStateWorker
    ) {
      warnings.push(
        "Massachusetts nonresident multistate withholding can require allocating only Massachusetts-source wages. This calculator uses the current paycheck's taxable wages as fully Massachusetts-source unless you manually adjust the wage base."
      )
    }

    if (context.profile.massachusettsMsrraExempt && residenceState === "Massachusetts") {
      warnings.push(
        "The Massachusetts M-4-MS military spouse exemption is generally for a qualifying nonresident military spouse, so review that election if the employee is a Massachusetts resident."
      )
    }

    if (context.profile.massachusettsFullTimeStudentExempt) {
      warnings.push(
        "Massachusetts full-time student exemption applies only to a seasonal, part-time, or temporary employee who reasonably expects annual income of $8,000 or less."
      )
    }

    return createStateCalculationResult("Massachusetts M-4 payroll withholding", "dedicated", {
      stateTax: calculateMassachusettsWithholding({
        taxableIncome: context.taxableIncome,
        payFrequency: context.payFrequency,
        filingStatus: context.filingStatus,
        state: context.state,
        residenceState: context.residenceState,
        workState: context.workState,
        massachusettsExemptions: context.profile.massachusettsExemptions,
        massachusettsBlindExemptions: context.profile.massachusettsBlindExemptions,
        massachusettsFullTimeStudentExempt: context.profile.massachusettsFullTimeStudentExempt,
        massachusettsMsrraExempt: context.profile.massachusettsMsrraExempt,
        massachusettsAdditionalWithholding: context.profile.massachusettsAdditionalWithholding,
      }),
      warnings,
    })
  },
}
