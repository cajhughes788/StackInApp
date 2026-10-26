// /shared/estimatedTax/dataHealth.ts
// ------------------------------------------------------------
// Decides whether the app knows enough to show a tax estimate at all. A
// shaky number shown confidently is worse than no number, so each problem
// says what to fix. Two outputs:
//
//   canShowEstimate   — the "what you'll likely owe" estimate
//   canShowSafeHarbor — the penalty-free amount from last year's tax, which
//                       doesn't depend on this year's records at all
//
// Pure — the caller gathers the counts (step 2).
// ------------------------------------------------------------
import type { FilingStatus } from "./types"

export type TaxSituationAnswers = {
  // Each is null until the person answers it.
  spouseHasIncome: boolean | null
  investmentOrRentalIncome: boolean | null
  itemizesDeductions: boolean | null
}

export type DataHealthInput = {
  today: string // YYYY-MM-DD
  taxYear: number
  hasTaxYearTable: boolean
  profile: {
    filingStatus: FilingStatus | null
    qualifyingChildren: number | null
    // When the business started this year, if after Jan 1 — so records
    // that start late aren't read as "income is missing".
    businessStartDate: string | null
    situation: TaxSituationAnswers
    priorYearTax: number | null
  }
  // Earliest income or expense recorded in the tax year (null = none).
  firstRecordDate: string | null
  uncategorizedExpenseCount: number
  pendingBankReviewCount: number
  pendingImportCount: number
}

export type DataHealthIssueCode =
  | "no_tax_year_table"
  | "missing_filing_status"
  | "missing_children"
  | "situation_unanswered"
  | "complex_situation"
  | "no_records"
  | "too_little_history"
  | "missing_earlier_months"
  | "unreviewed_bank_deposits"
  | "uncategorized_expenses"
  | "unreviewed_imports"

export type DataHealthIssue = {
  code: DataHealthIssueCode
  // blocker: no estimate until fixed. warning: estimate shown, marked rough.
  severity: "blocker" | "warning"
  message: string
}

export type DataHealthStatus =
  | "ready" // estimate shown
  | "rough" // estimate shown with warnings
  | "needs_profile" // a few questions first
  | "needs_records" // fix the records first
  | "unsupported" // situation or year the estimate can't handle

export type DataHealthResult = {
  status: DataHealthStatus
  canShowEstimate: boolean
  canShowSafeHarbor: boolean
  issues: DataHealthIssue[]
}

// Under ~2 months of a year, the annualized estimate swings too much.
export const MIN_HISTORY_DAYS = 60
// A record start later than this (with no start date given) looks like
// income missing from earlier in the year.
export const LATE_RECORDS_GRACE_DAYS = 31
// This many unreviewed items can move the number a lot: block, don't warn.
export const REVIEW_BLOCKER_COUNT = 10

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)
  return Math.floor(ms / 86_400_000)
}

function formatShortDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

export function assessTaxDataHealth(input: DataHealthInput): DataHealthResult {
  const issues: DataHealthIssue[] = []
  const { profile } = input
  const yearStart = `${input.taxYear}-01-01`

  if (!input.hasTaxYearTable) {
    issues.push({
      code: "no_tax_year_table",
      severity: "blocker",
      message: `Tax estimates for ${input.taxYear} aren't available yet. We add them once the IRS publishes the year's numbers.`,
    })
    return { status: "unsupported", canShowEstimate: false, canShowSafeHarbor: false, issues }
  }

  // ---- The person's situation ----
  if (!profile.filingStatus) {
    issues.push({ code: "missing_filing_status", severity: "blocker", message: "Choose how you file (single, married, head of household)." })
  }
  if (profile.qualifyingChildren == null) {
    issues.push({ code: "missing_children", severity: "blocker", message: "Tell us how many children you claim." })
  }
  const answers = [profile.situation.spouseHasIncome, profile.situation.investmentOrRentalIncome, profile.situation.itemizesDeductions]
  if (answers.some((answer) => answer == null)) {
    issues.push({ code: "situation_unanswered", severity: "blocker", message: "Answer three quick questions about other income and deductions." })
  }
  const complex = answers.some((answer) => answer === true)
  if (complex) {
    issues.push({
      code: "complex_situation",
      severity: "blocker",
      message: "Your situation needs a tax pro for an exact number. We'll still show the amount that avoids a penalty.",
    })
  }

  // ---- The records ----
  const coverageStart =
    profile.businessStartDate && profile.businessStartDate > yearStart ? profile.businessStartDate : yearStart
  if (!input.firstRecordDate) {
    issues.push({ code: "no_records", severity: "blocker", message: `Add income or expenses for ${input.taxYear} to see an estimate.` })
  } else {
    if (daysBetween(coverageStart, input.today) < MIN_HISTORY_DAYS) {
      issues.push({
        code: "too_little_history",
        severity: "blocker",
        message: "We need about two months of records before estimating the year.",
      })
    }
    if (!profile.businessStartDate && daysBetween(yearStart, input.firstRecordDate) > LATE_RECORDS_GRACE_DAYS) {
      issues.push({
        code: "missing_earlier_months",
        severity: "blocker",
        message: `Your records start ${formatShortDate(input.firstRecordDate)}. Add earlier income, or tell us your business started then.`,
      })
    }
  }

  const reviewIssue = (
    code: DataHealthIssueCode,
    count: number,
    one: string,
    many: string,
    action: string
  ) => {
    if (count <= 0) return
    issues.push({
      code,
      severity: count >= REVIEW_BLOCKER_COUNT ? "blocker" : "warning",
      message: `${action} ${plural(count, one, many)} for a better estimate.`,
    })
  }
  reviewIssue("unreviewed_bank_deposits", input.pendingBankReviewCount, "bank transaction", "bank transactions", "Review")
  reviewIssue("uncategorized_expenses", input.uncategorizedExpenseCount, "expense", "expenses", "Categorize")
  reviewIssue("unreviewed_imports", input.pendingImportCount, "imported item", "imported items", "Review")

  const blockers = issues.filter((issue) => issue.severity === "blocker")
  const canShowEstimate = blockers.length === 0
  // Last year's tax is a fact on their return, so the penalty-free amount
  // only needs that (and a filing status for the 110% AGI rule).
  const canShowSafeHarbor = profile.priorYearTax != null && profile.filingStatus != null

  let status: DataHealthStatus
  if (canShowEstimate) status = issues.length > 0 ? "rough" : "ready"
  else if (complex) status = "unsupported"
  else if (blockers.some((issue) => ["missing_filing_status", "missing_children", "situation_unanswered"].includes(issue.code))) status = "needs_profile"
  else status = "needs_records"

  return { status, canShowEstimate, canShowSafeHarbor, issues }
}
