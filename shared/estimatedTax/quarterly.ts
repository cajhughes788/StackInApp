// /shared/estimatedTax/quarterly.ts
// ------------------------------------------------------------
// What to pay by the next due date, from the year's monthly records.
//
//   penaltyFree     — from last year's tax (Form 1040-ES safe harbor): a
//                     fact on their return, so this is the headline.
//   basedOnEarnings — the IRS annualized income method (Form 2210 Sch. AI):
//                     income actually earned through the quarter, scaled
//                     to a year. Handles slow starts and busy seasons.
//   range           — the year's likely federal tax, two ways: if the rest
//                     of the year looks like the year so far, and if it
//                     looks like the last three months.
//
// The IRS requires the smaller of the regular and annualized installment;
// with this year's tax estimated from the same annualized income, that is
// min(annualized tax × 22.5% per quarter, prior-year target × 25% per
// quarter). Withholding counts as paid evenly through the year.
// Pure — the caller gathers the months.
// ------------------------------------------------------------
import { computeFederalEstimate, computeSafeHarborTarget, round2, type FederalEstimate, type SafeHarborTarget } from "./calculate"
import type { EstimatedTaxYear, FilingStatus } from "./types"
import { computeStateTax, type StateTaxResult } from "./states"

export type MonthFigures = {
  month: string // YYYY-MM in the tax year
  profit: number // business income − expenses (all business workspaces)
  w2Wages: number // W-2 gross pay
  tips?: number // tips within that profit (for the tips deduction)
}

export type QuarterlyInput = {
  today: string // YYYY-MM-DD, in the tax year (or before the Jan due date after it)
  filingStatus: FilingStatus
  qualifyingChildren: number
  months: MonthFigures[]
  priorYearTax: number | null
  priorYearAgi: number | null
  // Federal income tax withheld so far, typed from a real pay stub.
  ytdWithholding: number | null
  withholdingAsOf: string | null
  estimatedPaymentsMade: number
  // Line of work for the "no tax on tips" deduction (tippedOccupations.ts).
  occupationCode?: string | null
  // Two-letter state code (states.ts).
  stateCode?: string | null
}

export type QuarterlyResult = {
  quarter: 1 | 2 | 3 | 4
  dueDate: string
  periodEnd: string
  // Through-period income was used (the period has ended) vs pace so far.
  basis: "period_complete" | "year_to_date_pace"
  annualized: { profit: number; w2Wages: number; tips: number; estimate: FederalEstimate }
  range: {
    low: number
    high: number
    yearPace: FederalEstimate
    recentPace: FederalEstimate
  }
  safeHarbor: SafeHarborTarget
  annualWithholding: number
  withholdingCredit: number
  paymentsCredit: number
  // Due by dueDate (cumulative for the year minus what's been paid).
  penaltyFree: number | null
  basedOnEarnings: number
  // Under $1,000 owed after withholding: no estimated payments required.
  belowEstimatesThreshold: boolean
  // Share of each extra business dollar that goes to federal tax (for
  // "safe to spend"). Null without profit.
  businessTaxRate: number | null
  // State income tax for the year (paid to the state, separately from the
  // IRS). Range uses the same two paces as the federal range.
  state: { annualized: StateTaxResult; low: number; high: number }
  unsupported: FederalEstimate["unsupported"]
}

const QUARTER_SHARE = 0.225 // 90% of the year's tax over four installments

function dayOfYear(date: string): number {
  const [y, m, d] = date.split("-").map(Number)
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1
}

function daysInYear(year: number): number {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000
}

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function sum(months: MonthFigures[], key: "profit" | "w2Wages" | "tips"): number {
  return months.reduce((total, month) => total + (Number(month[key]) || 0), 0)
}

export function pickNextQuarter(table: EstimatedTaxYear, today: string) {
  return table.quarters.find((q) => q.dueDate >= today) ?? table.quarters[table.quarters.length - 1]
}

export function computeQuarterlyEstimate(table: EstimatedTaxYear, input: QuarterlyInput): QuarterlyResult {
  const year = table.year
  const yearDays = daysInYear(year)
  const inYear = input.today.startsWith(`${year}-`)
  const elapsed = inYear ? dayOfYear(input.today) : yearDays
  const currentMonth = inYear ? input.today.slice(0, 7) : `${year}-12`
  const months = input.months.filter((m) => m.month.startsWith(`${year}-`) && m.month <= currentMonth)
  const next = pickNextQuarter(table, input.today)
  const occupationCode = input.occupationCode ?? null
  const estimateFor = (profit: number, w2Wages: number, tips = 0) =>
    computeFederalEstimate(table, {
      filingStatus: input.filingStatus,
      selfEmploymentProfit: profit,
      w2Wages,
      qualifyingChildren: input.qualifyingChildren,
      tips: { amount: tips, occupationCode },
    })

  // ---- Year so far, scaled to a full year ----
  const ytdProfit = sum(months, "profit")
  const ytdWages = sum(months, "w2Wages")
  const ytdTips = sum(months, "tips")
  const paceFactor = yearDays / elapsed
  const yearPaceProfit = round2(ytdProfit * paceFactor)
  const yearPaceWages = round2(ytdWages * paceFactor)
  const yearPace = estimateFor(yearPaceProfit, yearPaceWages, round2(ytdTips * paceFactor))

  // ---- The last three complete months, carried through the year ----
  const complete = months.filter((m) => m.month < currentMonth).slice(-3)
  const remainingDays = yearDays - elapsed
  let recentPace = yearPace
  let recentPaceProfit = yearPaceProfit
  let recentPaceWages = yearPaceWages
  if (complete.length > 0 && remainingDays > 0) {
    const days = complete.reduce((total, m) => total + daysInMonth(m.month), 0)
    recentPaceProfit = round2(ytdProfit + (sum(complete, "profit") / days) * remainingDays)
    recentPaceWages = round2(ytdWages + (sum(complete, "w2Wages") / days) * remainingDays)
    recentPace = estimateFor(
      recentPaceProfit,
      recentPaceWages,
      round2(ytdTips + (sum(complete, "tips") / days) * remainingDays)
    )
  }

  // ---- The annualized income for this installment ----
  const periodMonth = next.periodEnd.slice(0, 7)
  const periodComplete = input.today > next.periodEnd
  const annualizedProfit = periodComplete
    ? round2(sum(months.filter((m) => m.month <= periodMonth), "profit") * next.annualizationFactor)
    : round2(ytdProfit * paceFactor)
  const annualizedWages = periodComplete
    ? round2(sum(months.filter((m) => m.month <= periodMonth), "w2Wages") * next.annualizationFactor)
    : round2(ytdWages * paceFactor)
  const annualizedTips = periodComplete
    ? round2(sum(months.filter((m) => m.month <= periodMonth), "tips") * next.annualizationFactor)
    : round2(ytdTips * paceFactor)
  const annualized = estimateFor(annualizedProfit, annualizedWages, annualizedTips)

  // ---- Credits: withholding (evenly through the year) and payments ----
  let annualWithholding = 0
  if (input.ytdWithholding != null && input.ytdWithholding > 0) {
    const asOf = input.withholdingAsOf && input.withholdingAsOf.startsWith(`${year}-`) ? input.withholdingAsOf : input.today
    const asOfDays = asOf.startsWith(`${year}-`) ? dayOfYear(asOf) : yearDays
    annualWithholding = round2(input.ytdWithholding * (yearDays / asOfDays))
  }
  const quarterNumber = next.quarter
  const withholdingCredit = round2(annualWithholding * 0.25 * quarterNumber)
  const paymentsCredit = round2(Math.max(0, input.estimatedPaymentsMade || 0))

  const safeHarbor = computeSafeHarborTarget(table, {
    filingStatus: input.filingStatus,
    priorYearTax: input.priorYearTax,
    priorYearAgi: input.priorYearAgi,
    currentYearTax: annualized.totalTax,
  })
  const priorYearCumulative =
    safeHarbor.priorYearTarget == null ? null : round2(safeHarbor.priorYearTarget * 0.25 * quarterNumber)
  const annualizedCumulative = round2(annualized.totalTax * QUARTER_SHARE * quarterNumber)
  const owed = (cumulative: number) => round2(Math.max(0, cumulative - withholdingCredit - paymentsCredit))

  const belowEstimatesThreshold =
    annualized.totalTax - annualWithholding < table.safeHarbor.minimumOwedForEstimates
  const basedOnEarnings = belowEstimatesThreshold
    ? 0
    : owed(priorYearCumulative == null ? annualizedCumulative : Math.min(annualizedCumulative, priorYearCumulative))

  const stateFor = (estimate: FederalEstimate, profit: number, w2Wages: number) =>
    computeStateTax(table.states, input.stateCode ?? null, {
      filingStatus: input.filingStatus,
      federalAgi: estimate.lines.adjustedGrossIncome,
      selfEmploymentProfit: profit,
      w2Wages,
      qualifyingChildren: input.qualifyingChildren,
    })
  const stateTax = (result: StateTaxResult) => (result.status === "included" ? result.tax : 0)
  const stateAnnualized = stateFor(annualized, annualizedProfit, annualizedWages)
  const stateYearPace = stateTax(stateFor(yearPace, yearPaceProfit, yearPaceWages))
  const stateRecentPace = stateTax(stateFor(recentPace, recentPaceProfit, recentPaceWages))

  // Federal and state tax on each extra business dollar.
  let businessTaxRate: number | null = null
  if (annualizedProfit > 0) {
    const withoutBusiness = estimateFor(0, annualizedWages)
    const stateWithout = stateTax(stateFor(withoutBusiness, 0, annualizedWages))
    businessTaxRate = Math.max(
      0,
      (annualized.totalTax + stateTax(stateAnnualized) - withoutBusiness.totalTax - stateWithout) / annualizedProfit
    )
  }

  const unsupported = Array.from(new Set([...annualized.unsupported, ...yearPace.unsupported, ...recentPace.unsupported]))

  return {
    quarter: quarterNumber,
    dueDate: next.dueDate,
    periodEnd: next.periodEnd,
    basis: periodComplete ? "period_complete" : "year_to_date_pace",
    annualized: { profit: annualizedProfit, w2Wages: annualizedWages, tips: annualizedTips, estimate: annualized },
    range: {
      low: Math.min(yearPace.totalTax, recentPace.totalTax),
      high: Math.max(yearPace.totalTax, recentPace.totalTax),
      yearPace,
      recentPace,
    },
    safeHarbor,
    annualWithholding,
    withholdingCredit,
    paymentsCredit,
    penaltyFree: priorYearCumulative == null ? null : owed(priorYearCumulative),
    basedOnEarnings,
    belowEstimatesThreshold,
    businessTaxRate,
    state: {
      annualized: stateAnnualized,
      low: Math.min(stateYearPace, stateRecentPace),
      high: Math.max(stateYearPace, stateRecentPace),
    },
    unsupported,
  }
}
