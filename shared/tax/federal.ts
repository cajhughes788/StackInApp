// /shared/tax/federal.ts

import { d, clampNonNegative } from "./math"
import { PAYROLL_2026 } from "./tables/payroll2026"
import type { AnnualRateScheduleRow, FilingStatus, PayrollYearParams, TaxProfileInput } from "./types"

type FederalPayrollFrequency = TaxProfileInput["payFrequency"]

function getPeriodsPerYear(freq: FederalPayrollFrequency): number {
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

function findAnnualRateRow(
  schedule: AnnualRateScheduleRow[],
  adjustedAnnualWages: number
): AnnualRateScheduleRow {
  const match = schedule.find(
    (row) => adjustedAnnualWages >= row.atLeast && (row.lessThan == null || adjustedAnnualWages < row.lessThan)
  )

  if (!match) {
    return schedule[schedule.length - 1]
  }

  return match
}

function calculateTentativeAnnualWithholding(
  adjustedAnnualWages: number,
  filingStatus: FilingStatus,
  useStep2CheckboxRates: boolean,
  params: PayrollYearParams
): number {
  const schedules = useStep2CheckboxRates ? params.step2Schedules : params.standardSchedules
  const row = findAnnualRateRow(schedules[filingStatus], adjustedAnnualWages)
  const wagesOverThreshold = Math.max(adjustedAnnualWages - row.baseThreshold, 0)
  return row.baseWithholding + wagesOverThreshold * row.rate
}

function getWorksheet1AAdjustment(
  filingStatus: FilingStatus,
  useStep2CheckboxRates: boolean,
  params: PayrollYearParams
): number {
  if (useStep2CheckboxRates) {
    return 0
  }

  return filingStatus === "marriedJoint"
    ? params.worksheet1AAdjustment.marriedJoint
    : params.worksheet1AAdjustment.other
}

/**
 * Federal withholding calculator.
 *
 * Implements the IRS Publication 15-T percentage-method payroll worksheet
 * using the annual automated payroll rate schedules for 2020-and-later Forms
 * W-4, with the given year's tables (payrollYears.ts; 2026 by default).
 */
export function calculateFederalTax(profile: Pick<
  TaxProfileInput,
  | "grossIncome"
  | "payFrequency"
  | "filingStatus"
  | "federalMultipleJobsCheckbox"
  | "federalStep3Credits"
  | "federalOtherIncome"
  | "federalDeductions"
  | "federalExempt"
  | "additionalFederalWithholding"
  | "dependents"
>, params: PayrollYearParams = PAYROLL_2026): number {
  if (profile.federalExempt) {
    return 0
  }

  const periods = getPeriodsPerYear(profile.payFrequency)
  const annualWages = d(profile.grossIncome).mul(periods)
  const useStep2CheckboxRates = Boolean(profile.federalMultipleJobsCheckbox)
  const adjustedAnnualWages = clampNonNegative(
    annualWages
      .add(d(profile.federalOtherIncome ?? 0))
      .sub(d(profile.federalDeductions ?? 0))
      .sub(d(getWorksheet1AAdjustment(profile.filingStatus, useStep2CheckboxRates, params)))
  )

  const tentativeAnnualWithholding = calculateTentativeAnnualWithholding(
    adjustedAnnualWages.toNumber(),
    profile.filingStatus,
    useStep2CheckboxRates,
    params
  )

  // Without an entered Step 3 total, assume each dependent is a qualifying
  // child (the profile only stores a count) — the year's per-child amount.
  const annualStep3Credits =
    profile.federalStep3Credits ??
    (profile.dependents != null ? profile.dependents * params.childTaxCredit : 0)
  const annualWithholdingAfterCredits = Math.max(tentativeAnnualWithholding - annualStep3Credits, 0)
  const perPeriodWithholding = d(annualWithholdingAfterCredits)
    .div(periods)
    .add(d(profile.additionalFederalWithholding ?? 0))
    .toDecimalPlaces(2)

  return clampNonNegative(perPeriodWithholding).toNumber()
}
