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
    stateCode: string | null
    // W-2 income question answered for the person's current W-2
    // workspaces (hasW2Workspace picks which question was asked).
    w2: { hasW2Workspace: boolean; answered: boolean }
    // Tips are recorded but no line of work is chosen yet.
    tipsNeedOccupation: boolean
    // W-2 tips but no line of work chosen for the job yet.
    w2TipsNeedOccupation?: boolean
    // The answers form's "everything is complete" box was ticked.
    confirmedComplete: boolean
  }
  // Earliest income or expense recorded in the tax year (null = none).
  firstRecordDate: string | null
  uncategorizedExpenseCount: number
  pendingBankReviewCount: number
  pendingImportCount: number
  // Expenses whose bank charge was later removed (flaggedReason
  // "bank_reversed"): they still lower profit until checked.
  reversedExpenseCount: number
}

export type DataHealthIssueCode =
  | "no_tax_year_table"
  | "missing_filing_status"
  | "missing_children"
  | "situation_unanswered"
  | "missing_state"
  | "w2_unanswered"
  | "missing_occupation"
  | "missing_w2_occupation"
  | "not_confirmed"
  | "complex_situation"
  | "other_income"
  | "no_records"
  | "too_little_history"
  | "missing_earlier_months"
  | "unreviewed_bank_deposits"
  | "uncategorized_expenses"
  | "unreviewed_imports"
  | "reversed_expenses"

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

// Problems the person fixes in the answers form (vs. in their records).
export const PROFILE_CODES: DataHealthIssueCode[] = [
  "missing_filing_status",
  "missing_children",
  "situation_unanswered",
  "missing_state",
  "w2_unanswered",
  "missing_occupation",
  "missing_w2_occupation",
  "not_confirmed",
]

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
  if (!profile.stateCode) {
    issues.push({ code: "missing_state", severity: "blocker", message: "Choose the state you live in." })
  }
  if (!profile.w2.answered) {
    issues.push({
      code: "w2_unanswered",
      severity: "blocker",
      message: profile.w2.hasW2Workspace
        ? "Tell us whether all of your W-2 income is recorded in 521."
        : "Tell us whether you have a W-2 job.",
    })
  }
  if (profile.tipsNeedOccupation) {
    issues.push({ code: "missing_occupation", severity: "blocker", message: "Choose your line of work — you have tips recorded." })
  }
  if (profile.w2TipsNeedOccupation) {
    issues.push({ code: "missing_w2_occupation", severity: "blocker", message: "Choose your line of work at your W-2 job — you have W-2 tips." })
  }
  if (!profile.confirmedComplete) {
    issues.push({ code: "not_confirmed", severity: "blocker", message: "Confirm that your answers are complete." })
  }
  // Other income (investments, rentals, side jobs) isn't in the records, so
  // the estimate runs low — still shown, marked rough. A spouse's income or
  // itemizing changes the whole calculation, so those still need a tax pro.
  if (profile.situation.investmentOrRentalIncome === true) {
    issues.push({
      code: "other_income",
      severity: "warning",
      message: "Rough: this doesn't include your other income (investments, rentals, side jobs), so your real tax will likely be higher.",
    })
  }
  const complex = profile.situation.spouseHasIncome === true || profile.situation.itemizesDeductions === true
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
  reviewIssue("reversed_expenses", input.reversedExpenseCount, "expense your bank reversed", "expenses your bank reversed", "Check")

  const blockers = issues.filter((issue) => issue.severity === "blocker")
  const canShowEstimate = blockers.length === 0
  // Last year's tax is a fact on their return, so the penalty-free amount
  // only needs that (and a filing status for the 110% AGI rule).
  // Every answer is required first: nothing is shown with answers missing.
  const canShowSafeHarbor =
    profile.priorYearTax != null &&
    profile.filingStatus != null &&
    !blockers.some((issue) => PROFILE_CODES.includes(issue.code))

  let status: DataHealthStatus
  if (canShowEstimate) status = issues.length > 0 ? "rough" : "ready"
  else if (complex) status = "unsupported"
  else if (blockers.some((issue) => PROFILE_CODES.includes(issue.code))) status = "needs_profile"
  else status = "needs_records"

  return { status, canShowEstimate, canShowSafeHarbor, issues }
}
