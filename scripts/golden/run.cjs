// Tax audit, part 4: run one golden scenario through the real backend —
// records saved in the in-memory database, P&L statements built from them,
// getTaxEstimate — and report what the Taxes page and the reminder push
// would show.
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
})

const path = require("node:path")
const Module = require("node:module")
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@shared/")) {
    request = path.join(__dirname, "..", "..", "shared", request.slice("@shared/".length))
  }
  return originalResolve.call(this, request, ...rest)
}

const { installFakeFirestore } = require("../helpers/fake-firestore.cjs")
const db = installFakeFirestore()
const backend = path.join(__dirname, "..", "..", "backend", "functions", "src")
const { syncProfitLossForFinancialDates } = require(path.join(backend, "services", "profitLossService.ts"))
const { getTaxEstimate } = require(path.join(backend, "services", "taxEstimateService.ts"))
const { getEstimatedTaxYear } = require("../../shared/estimatedTax/years/index.ts")
const { pickTaxReminder, buildTaxReminderMessage } = require("../../shared/estimatedTax/reminders.ts")
const { taxHeadline, headlineAmount } = require("../../shared/estimatedTax/headline.ts")
const { PROFILE_CODES } = require("../../shared/estimatedTax/dataHealth.ts")
const { DateTime } = require("luxon")
const { PEOPLE, MONTHS } = require("./scenarios.cjs")

const UID = "golden"
const BIZ = "biz"
const JOB = "job"

const wholeDollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
const dollars = (n) => wholeDollars.format(Math.ceil(n))

function dueLabel(date) {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

function seed(s) {
  db.reset()
  const person = PEOPLE[s.person]
  db.seed(`workspaces/${BIZ}`, { name: "Business", type: "independent", status: "active" })
  db.seed(`users/${UID}/memberships/${BIZ}`, { role: "owner" })
  db.seed(`workspaces/${BIZ}/settings/current`, { independent: {} })

  const year = s.year
  const lastMonth = s.today.startsWith(String(year + 1)) ? 12 : Number(s.today.slice(5, 7))
  const dates = []
  for (let m = s.startMonth; m <= lastMonth; m++) {
    const month = `${year}-${MONTHS[m - 1]}`
    const date = `${month}-01`
    const { services, tips, expenses } = person.month(m - 1)
    db.seed(`workspaces/${BIZ}/entries/in-${month}`, {
      workspace: "independent",
      periodId: month,
      date,
      notes: "",
      independent: { incomeBreakdowns: [{ paymentMethod: "card", services, ...(tips ? { tips } : {}) }] },
    })
    if (expenses) {
      db.seed(`workspaces/${BIZ}/expenses/out-${month}`, {
        date, amount: expenses, vendor: "Supply Co", description: "", account: "Supplies",
        periodId: month, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1,
      })
    }
    dates.push(date)
  }

  const firstMonth = `${year}-${MONTHS[Math.min(s.startMonth, 12) - 1]}`
  const problemExpense = (id, extra) =>
    db.seed(`workspaces/${BIZ}/expenses/${id}`, {
      date: `${firstMonth}-02`, amount: 40, vendor: "Bank", description: "", account: "Supplies",
      periodId: firstMonth, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1, ...extra,
    })
  for (let i = 0; i < (s.problems.uncategorized ?? 0); i++) problemExpense(`uncat-${i}`, { account: "Uncategorized" })
  for (let i = 0; i < (s.problems.reversed ?? 0); i++) problemExpense(`rev-${i}`, { flaggedReason: "bank_reversed" })
  if (s.problems.uncategorized || s.problems.reversed) dates.push(`${firstMonth}-02`)
  for (let i = 0; i < (s.problems.pendingBank ?? 0); i++) {
    db.seed(`workspaces/${BIZ}/plaidPendingTransactions/p${i}`, { status: "pending" })
  }
  if (s.problems.imports) db.seed(`workspaces/${BIZ}/importBatches/b1`, { status: "active", pendingCount: s.problems.imports })

  if (s.w2PerMonth) {
    db.seed(`workspaces/${JOB}`, { name: "Job", type: "w2", status: "active" })
    db.seed(`users/${UID}/memberships/${JOB}`, { role: "owner" })
    for (let m = 1; m <= lastMonth; m++) {
      const month = `${year}-${MONTHS[m - 1]}`
      db.seed(`workspaces/${JOB}/entries/pay-${month}`, {
        workspace: "w2", periodId: month, date: `${month}-15`, notes: "", w2: { tips: s.w2TipsPerMonth ?? 0 },
        totals: { totalHours: 0, paidHours: 0, breakDeductionAmount: 0, customDeductionsAmount: 0, dayTotal: s.w2PerMonth, taxableTotal: s.w2PerMonth },
      })
    }
  }

  for (const [i, p] of s.payments.entries()) {
    db.seed(`users/${UID}/taxPayments/pay${i}`, { taxYear: year, amount: p.amount, paidOn: p.paidOn, source: "manual", createdAt: `${p.paidOn}T12:00:00.000Z` })
  }

  const a = s.answers
  if (a.answered) {
    db.seed(`users/${UID}/taxEstimate/profile`, {
      taxYear: year,
      filingStatus: a.filingStatus,
      qualifyingChildren: a.qualifyingChildren,
      spouseHasIncome: a.spouseHasIncome,
      investmentOrRentalIncome: a.investmentOrRentalIncome,
      itemizesDeductions: a.itemizesDeductions,
      stateCode: a.stateCode,
      occupationCode: "occupationCode" in s ? s.occupationCode : person.occupationCode,
      businessStartDate: a.businessStartDate,
      priorYearTax: a.priorYearTax,
      priorYearAgi: a.priorYearAgi,
      // With a W-2 workspace the question is "all recorded in 521?";
      // without one, "do you have a W-2 job?".
      w2AllRecorded: s.w2PerMonth ? a.w2AllRecorded : null,
      hasW2Job: s.w2PerMonth ? null : a.hasW2Job,
      unrecordedW2Pay: a.unrecordedW2Pay,
      unrecordedW2Tips: a.unrecordedW2Tips,
      w2OccupationCode: a.w2OccupationCode,
      ytdWithholding: a.ytdWithholding,
      withholdingAsOf: a.withholdingAsOf,
      w2WorkspaceKey: s.w2PerMonth ? (a.w2WorkspaceKey ?? JOB) : null,
      confirmedComplete: a.confirmedComplete,
      estimatedPaymentsMade: 0,
      remindersEnabled: a.remindersEnabled,
      lastReminderKey: null,
      updatedAt: `${year}-01-02T00:00:00.000Z`,
    })
  }
  return dates
}

// The Taxes card's words, following tax-estimate-card.tsx.
function card(r) {
  const { health, quarterly: q, profile, taxYear } = r
  const issues = health.issues.map((i) => `${i.severity}: ${i.message}`)
  if (health.status === "needs_profile" && !profile.updatedAt) {
    return { headline: "We can't estimate your taxes yet.", lines: [], issues }
  }
  const missing = health.issues.filter((i) => i.severity === "blocker" && PROFILE_CODES.includes(i.code)).length
  const due = q ? dueLabel(q.dueDate) : null
  const lead = taxHeadline(health, q)
  const showSafeHarbor = lead?.kind === "penalty_free"
  const showEstimate = health.canShowEstimate && q != null
  const lines = []
  let headline = null
  if (showSafeHarbor) headline = q.penaltyFree === 0 ? `Nothing due by ${due}` : `Pay ${dollars(q.penaltyFree)} by ${due}`
  if (showEstimate) {
    if (q.belowEstimatesThreshold) {
      if (showSafeHarbor) lines.push("No quarterly payment needed")
      else headline = "No quarterly payment needed"
    } else if (showSafeHarbor) {
      const earningsLine = q.penaltyFree == null || q.basedOnEarnings < q.penaltyFree - 0.5
      if (earningsLine) lines.push(`Based on what you've earned so far, ${dollars(q.basedOnEarnings)} by ${due} also covers you.`)
    } else if (Math.ceil(q.basedOnEarnings) === 0) {
      headline = `Nothing more to set aside by ${due}`
      lines.push("Your payments cover it so far.")
    } else {
      headline = `Set aside about ${dollars(q.basedOnEarnings)} by ${due}`
    }
    lines.push("Based on your answers and the records in 521. If any income or expenses are missing, this number is wrong.")
    const one = q.range.high - q.range.low < 50
    const amount = one ? wholeDollars.format(q.range.high) : `${wholeDollars.format(q.range.low)}–${wholeDollars.format(q.range.high)}`
    lines.push(`${q.job ? "Your business adds about" : q.withholding ? "In all, job and business, you'll likely owe" : "You'll likely owe"} ${amount} in federal tax for ${taxYear}`)
    if (q.job) lines.push("Your W-2 paychecks already cover the tax on your job pay.")
    if (q.withholding) lines.push(`Your paychecks will withhold about ${wholeDollars.format(q.withholding.annual)} of that this year; subtracted.`)
    if (q.job || q.withholding) lines.push("You can also cover this by asking your employer to withhold more (a new W-4).")
    const st = q.state.annualized
    if (st.status === "included") lines.push(`State: ${wholeDollars.format(q.state.low)}–${wholeDollars.format(q.state.high)} (${st.stateCode})`)
    else lines.push(`State: ${st.status}`)
    lines.push(`Tips deduction: ${q.annualized.estimate.tipsDeductionStatus}`)
    if (q.unsupported.includes("qbi_above_threshold")) lines.push("Warning: business income deduction shrinks at this income")
  }
  if (missing > 0) lines.unshift(`Your estimate is paused. We need ${missing} more ${missing === 1 ? "answer" : "answers"} before we can estimate your taxes.`)
  return { headline, lines, issues }
}

// The push sendTaxRemindersDaily would send today, if any.
function reminder(r, s) {
  const table = getEstimatedTaxYear(r.taxYear)
  // No table for the year yet: the scheduler sends nothing (it returns early).
  if (!table || !r.profile.updatedAt || !r.profile.remindersEnabled) return null
  const pick = pickTaxReminder(table, s.today, r.payments)
  if (!pick || !r.quarterly || r.quarterly.dueDate !== pick.dueDate) return null
  const amount = headlineAmount(taxHeadline(r.health, r.quarterly))
  if (!(amount >= 1)) return null
  const message = buildTaxReminderMessage(pick, amount)
  return `${message.title} — ${message.body}`
}

async function runScenario(s) {
  const dates = seed(s)
  if (dates.length) await syncProfitLossForFinancialDates(BIZ, dates)
  const r = await getTaxEstimate(UID, DateTime.fromISO(`${s.today}T12:00:00`, { zone: "America/Los_Angeles" }))
  if (!r.eligible) return { eligible: false }
  const q = r.quarterly
  const cents = (n) => (n == null ? null : Math.round(n * 100) / 100)
  return {
    taxYear: r.taxYear,
    status: r.health.status,
    card: card(r),
    reminder: reminder(r, s),
    numbers: {
      ytdProfit: r.ytdProfit,
      ytdTips: r.ytdTips,
      firstRecordDate: r.firstRecordDate ?? null,
      ...(q
        ? {
            quarter: q.quarter,
            dueDate: q.dueDate,
            basis: q.basis,
            penaltyFree: cents(q.penaltyFree),
            basedOnEarnings: cents(q.basedOnEarnings),
            annualizedProfit: cents(q.annualized.profit),
            yearTax: cents(q.annualized.estimate.totalTax),
            method: q.method,
            businessTax: cents(q.businessTax),
            withholdingAnnual: q.withholding ? cents(q.withholding.annual) : null,
            withholdingCredit: q.withholding ? cents(q.withholding.credit) : null,
            jobOnlyTax: q.job ? cents(q.job.jobOnlyTax) : null,
            annualizedW2: cents(q.annualized.w2Wages),
            rangeLow: cents(q.range.low),
            rangeHigh: cents(q.range.high),
            stateLow: cents(q.state.low),
            stateHigh: cents(q.state.high),
            paymentsCredit: cents(q.paymentsCredit),
            businessTaxRate: q.businessTaxRate == null ? null : Math.round(q.businessTaxRate * 10_000) / 10_000,
          }
        : { quarter: null }),
    },
  }
}

module.exports = { runScenario }
