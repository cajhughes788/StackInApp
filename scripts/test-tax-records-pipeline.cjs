// Tax audit, part 1: do the right records add up to the right profit?
//
// Runs the real backend services — createEntry / updateEntry / deleteEntry,
// createExpense / updateExpense / deleteExpense, the P&L statements they
// keep in sync, and getTaxEstimate — against an in-memory database
// (helpers/fake-firestore.cjs), then checks the profit, tips, first record
// date and warnings the estimate sees against numbers worked out by hand.
// Usage: node scripts/test-tax-records-pipeline.cjs
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
})

const path = require("node:path")
const Module = require("node:module")
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@shared/")) {
    request = path.join(__dirname, "..", "shared", request.slice("@shared/".length))
  }
  return originalResolve.call(this, request, ...rest)
}

const assert = require("node:assert/strict")
const { installFakeFirestore } = require("./helpers/fake-firestore.cjs")

const db = installFakeFirestore()
const backend = path.join(__dirname, "..", "backend", "functions", "src")
const entriesSvc = require(path.join(backend, "services", "entriesService.ts"))
const expensesSvc = require(path.join(backend, "services", "expensesService.ts"))
const { listProfitLossStatements } = require(path.join(backend, "services", "profitLossService.ts"))
const { getTaxEstimate } = require(path.join(backend, "services", "taxEstimateService.ts"))
const { EXPENSE_CATEGORY_GUIDE } = require("../shared/expenseCategories.ts")
const { DateTime } = require("luxon")

// The services log a warning when a best-effort step fails; keep the output
// readable, but fail the run if any were about P&L syncing.
const warnings = []
console.warn = (...args) => warnings.push(args.map(String).join(" "))

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

const UID = "user1"
const BIZ = "biz1"
const TODAY = "2026-10-27"

const ALL_ON = {
  trackProcessingFees: true,
  trackVehicleExpenses: true,
  trackBusinessMileage: true,
}

function addWorkspace(id, { type = "independent", status = "active", uid = UID, settings = {} } = {}) {
  db.seed(`workspaces/${id}`, { name: id, type, status })
  db.seed(`users/${uid}/memberships/${id}`, { role: "owner" })
  db.seed(`workspaces/${id}/settings/current`, type === "independent" ? { independent: { ...ALL_ON, ...settings } } : { w2: {} })
}

// Answers that never block the estimate, so each scenario sees only the
// records' effect.
function answerQuestions(overrides = {}) {
  db.seed(`users/${UID}/taxEstimate/profile`, {
    taxYear: 2026,
    filingStatus: "single",
    qualifyingChildren: 0,
    spouseHasIncome: false,
    investmentOrRentalIncome: false,
    itemizesDeductions: false,
    businessStartDate: null,
    stateCode: "TX",
    hasW2Job: false,
    confirmedComplete: true,
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  })
}

function fresh(settings) {
  db.reset()
  addWorkspace(BIZ, { settings })
  answerQuestions()
}

let mutation = 0
async function income(date, lines, extra = {}, workspaceId = BIZ) {
  const result = await entriesSvc.createEntry(workspaceId, UID, {
    workspace: "independent",
    date,
    notes: extra.notes ?? "",
    clientMutationId: `m${++mutation}`,
    independent: { incomeBreakdowns: lines, ...(extra.independent ?? {}) },
  })
  return result.id
}

async function refund(date, lines, reason = "requested_by_client", workspaceId = BIZ) {
  const result = await entriesSvc.createEntry(
    workspaceId,
    UID,
    { workspace: "independent", date, notes: "", clientMutationId: `m${++mutation}`, independent: { incomeBreakdowns: lines } },
    undefined,
    { refund: { reason, invoiceId: null, invoiceNumber: null, clientName: "Client", stripeRefundId: null, stripeDisputeId: null } }
  )
  return result.id
}

async function expense(date, amount, account = "Supplies", extra = {}, workspaceId = BIZ) {
  const result = await expensesSvc.createExpense(workspaceId, UID, {
    date,
    amount,
    vendor: extra.vendor ?? "Vendor",
    description: extra.description ?? "",
    account,
    ...extra,
  })
  return result.id
}

// An expense written the way bank imports can leave one: no category.
function seedUncategorizedExpense(id, date, amount, workspaceId = BIZ) {
  db.seed(`workspaces/${workspaceId}/expenses/${id}`, {
    date,
    amount,
    vendor: "Bank",
    description: "",
    account: "Uncategorized",
    periodId: date.slice(0, 7),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
  })
}

async function estimate(today = TODAY) {
  const result = await getTaxEstimate(UID, DateTime.fromISO(`${today}T12:00:00`, { zone: "America/Los_Angeles" }))
  assert.equal(result.eligible, true, "expected a business workspace")
  return result
}

async function monthProfit(periodKey, workspaceId = BIZ) {
  const statements = await listProfitLossStatements(workspaceId, UID, "month")
  return statements.find((s) => s.periodKey === periodKey)?.netProfit ?? 0
}

const cents = (n) => Math.round(n * 100) / 100
const issueCodes = (result) => result.health.issues.map((issue) => issue.code)
const issue = (result, code) => result.health.issues.find((i) => i.code === code)

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const tests = []
const test = (name, fn) => tests.push({ name, fn })

// ===========================================================================
// 1. Basic adding up
// ===========================================================================

test("1a one sale and one expense: profit = income − expenses", async () => {
  fresh()
  await income("2026-03-03", [{ paymentMethod: "card", services: 100 }])
  await expense("2026-03-05", 40)
  const r = await estimate()
  assert.equal(r.ytdProfit, 60)
  assert.equal(await monthProfit("2026-03"), 60)
})

test("1b a busy month adds up to the cent", async () => {
  fresh()
  for (let day = 1; day <= 20; day++) {
    await income(`2026-04-${String(day).padStart(2, "0")}`, [{ paymentMethod: "cash", services: 123.45 }])
  }
  for (let day = 1; day <= 10; day++) {
    await expense(`2026-04-${String(day).padStart(2, "0")}`, 19.99)
  }
  // 20 × 123.45 = 2,469.00; 10 × 19.99 = 199.90
  assert.equal((await estimate()).ytdProfit, 2269.1)
  assert.equal(await monthProfit("2026-04"), 2269.1)
})

test("1c profit is the sum of every month so far", async () => {
  fresh()
  await income("2026-01-15", [{ paymentMethod: "cash", services: 1000 }])
  await income("2026-05-15", [{ paymentMethod: "cash", services: 2000 }])
  await expense("2026-05-20", 500)
  await income("2026-10-01", [{ paymentMethod: "cash", services: 300 }])
  assert.equal((await estimate()).ytdProfit, 2800)
})

// ===========================================================================
// 2. Income types
// ===========================================================================

test("2a services, tips, products and other all count; tips also reported apart", async () => {
  fresh()
  await income("2026-02-10", [{ paymentMethod: "card", services: 100, tips: 20, products: 30, other: 10 }])
  const r = await estimate()
  assert.equal(r.ytdProfit, 160)
  assert.equal(r.ytdTips, 20)
})

test("2b one entry split across cash and card counts both lines", async () => {
  fresh()
  await income("2026-02-10", [
    { paymentMethod: "cash", services: 50 },
    { paymentMethod: "card", services: 70, tips: 10 },
  ])
  const r = await estimate()
  assert.equal(r.ytdProfit, 130)
  assert.equal(r.ytdTips, 10)
})

test("2c every payment method counts as income", async () => {
  fresh()
  const methods = ["cash", "card", "venmo", "apple_cash", "zelle", "pos", "other", "check", "cash_app"]
  for (const paymentMethod of methods) await income("2026-02-10", [{ paymentMethod, services: 10 }])
  assert.equal((await estimate()).ytdProfit, 90)
})

test("2d a refund subtracts; a won dispute adds it back", async () => {
  fresh()
  await income("2026-03-01", [{ paymentMethod: "card", services: 200 }])
  await refund("2026-03-10", [{ paymentMethod: "card", services: -40 }])
  assert.equal((await estimate()).ytdProfit, 160)
  await refund("2026-04-02", [{ paymentMethod: "card", services: 40 }], "dispute_reversed")
  assert.equal((await estimate()).ytdProfit, 200)
})

test("2e a refunded tip lowers the tips total too", async () => {
  fresh()
  await income("2026-03-01", [{ paymentMethod: "card", services: 100, tips: 30 }])
  await refund("2026-03-10", [{ paymentMethod: "card", tips: -30 }])
  const r = await estimate()
  assert.equal(r.ytdProfit, 100)
  assert.equal(r.ytdTips, 0, `a refunded tip should not stay in the tips deduction (got ${r.ytdTips})`)
})

test("2e2 a tip refunded next month, then won back in a dispute", async () => {
  fresh()
  await income("2026-03-01", [{ paymentMethod: "card", services: 100, tips: 30 }])
  await refund("2026-04-10", [{ paymentMethod: "card", tips: -30 }], "dispute")
  let r = await estimate()
  assert.equal(r.ytdProfit, 100)
  assert.equal(r.ytdTips, 0)
  await refund("2026-05-02", [{ paymentMethod: "card", tips: 30 }], "dispute_reversed")
  r = await estimate()
  assert.equal(r.ytdProfit, 130)
  assert.equal(r.ytdTips, 30)
})

test("2f custom income (mirrored into an 'other' line) is counted once", async () => {
  fresh()
  await income("2026-03-01", [{ paymentMethod: "other", other: 75 }], {
    independent: { customIncome: [{ label: "Class", amount: 75, category: "other" }] },
  })
  assert.equal((await estimate()).ytdProfit, 75)
})

test("2g 'Personal cash' is left out of business profit (by design)", async () => {
  fresh()
  await income("2026-03-01", [{ paymentMethod: "cash", services: 100 }], {
    independent: { unreportedCash: 200, unreportedCashTips: 200 },
  })
  assert.equal((await estimate()).ytdProfit, 100)
})

// ===========================================================================
// 3. Expense types
// ===========================================================================

test("3a every built-in category is subtracted in full", async () => {
  fresh()
  await income("2026-02-01", [{ paymentMethod: "cash", services: 5000 }])
  for (const entry of EXPENSE_CATEGORY_GUIDE) await expense("2026-02-02", 10, entry.category)
  const count = EXPENSE_CATEGORY_GUIDE.length
  assert.equal((await estimate()).ytdProfit, cents(5000 - 10 * count))
})

test("3b a custom category you typed is subtracted", async () => {
  fresh({ customExpenseCategories: ["Booth snacks"] })
  await income("2026-02-01", [{ paymentMethod: "cash", services: 100 }])
  await expense("2026-02-02", 12.5, "Booth snacks")
  assert.equal((await estimate()).ytdProfit, 87.5)
})

test("3c an uncategorized expense is subtracted and flagged", async () => {
  fresh()
  await income("2026-02-01", [{ paymentMethod: "cash", services: 100 }])
  await expense("2026-02-02", 1, "Supplies") // creates the month's statement
  seedUncategorizedExpense("u1", "2026-02-03", 30)
  await expense("2026-02-04", 1, "Supplies") // re-syncs February
  const r = await estimate()
  assert.equal(r.ytdProfit, 68)
  assert.equal(issue(r, "uncategorized_expenses")?.severity, "warning")
})

test("3d a card fee counts as an expense once, alongside a logged fee", async () => {
  fresh()
  await income("2026-02-01", [{ paymentMethod: "card", services: 100, fee: 3 }])
  assert.equal((await estimate()).ytdProfit, 97)
  await expense("2026-02-05", 5, "Payment Processing Fees")
  assert.equal((await estimate()).ytdProfit, 92)
})

// Only card, POS, Cash App and Venmo keep a cut (the app's fee box follows
// the same rule); a stray fee elsewhere is ignored.
test("3e a fee saved on a line without a processor is ignored", async () => {
  fresh()
  for (const paymentMethod of ["cash", "check", "zelle", "apple_cash", "other"]) {
    await income("2026-02-01", [{ paymentMethod, services: 100, fee: 3 }])
  }
  await income("2026-02-01", [{ paymentMethod: "venmo", services: 100, fee: 2 }])
  assert.equal((await estimate()).ytdProfit, 598)
})

test("3f rounding: 0.1 + 0.2 + 0.3 is 0.60, not 0.6000000000000001", async () => {
  fresh()
  await income("2026-02-01", [{ paymentMethod: "cash", services: 1 }])
  await expense("2026-02-02", 0.1)
  await expense("2026-02-03", 0.2)
  await expense("2026-02-04", 0.3)
  assert.equal((await estimate()).ytdProfit, 0.4)
})

test("3g a $0 expense changes nothing", async () => {
  fresh()
  await income("2026-02-01", [{ paymentMethod: "cash", services: 100 }])
  await expense("2026-02-02", 0)
  assert.equal((await estimate()).ytdProfit, 100)
})

test("3h a negative expense (money back from a vendor) raises profit", async () => {
  fresh()
  await income("2026-02-01", [{ paymentMethod: "cash", services: 100 }])
  await expense("2026-02-02", 50)
  await expense("2026-02-03", -15)
  assert.equal((await estimate()).ytdProfit, 65)
})

test("3i an expense the bank reversed still lowers profit, and the Taxes page warns", async () => {
  fresh()
  await income("2026-01-05", [{ paymentMethod: "cash", services: 100 }])
  const id = await expense("2026-02-02", 40)
  await expensesSvc.updateExpense(BIZ, UID, id, { flaggedReason: "bank_reversed" })
  let r = await estimate()
  assert.equal(r.ytdProfit, 60)
  assert.deepEqual(issueCodes(r), ["reversed_expenses"])
  assert.equal(issue(r, "reversed_expenses").message, "Check 1 expense your bank reversed for a better estimate.")
  // Deleting it (or clearing the flag) removes the warning.
  await expensesSvc.deleteExpense(BIZ, UID, id)
  r = await estimate()
  assert.deepEqual(issueCodes(r), [])
})

test("3i2 a reversed expense from last year doesn't warn this year", async () => {
  fresh()
  await income("2026-01-05", [{ paymentMethod: "cash", services: 100 }])
  const id = await expense("2025-11-02", 40)
  await expensesSvc.updateExpense(BIZ, UID, id, { flaggedReason: "bank_reversed" })
  assert.deepEqual(issueCodes(await estimate()), [])
})

// Decided 2026-10-27: the Taxes & Licenses wording now says income tax
// doesn't belong there; the app doesn't try to detect it.
test("3j federal income tax logged under Taxes & Licenses still lowers profit", async () => {
  fresh()
  await income("2026-02-01", [{ paymentMethod: "cash", services: 1000 }])
  await expense("2026-04-15", 300, "Taxes & Licenses", { vendor: "IRS", description: "Q1 estimated tax" })
  assert.equal((await estimate()).ytdProfit, 700)
})

// Decided 2026-10-27: keep full expensing (the common case for small
// businesses). For the CPA review: de minimis / Section 179 / bonus
// depreciation, mixed personal use, and vehicles.
test("3k a large equipment purchase is subtracted in full in its month", async () => {
  fresh()
  await income("2026-02-01", [{ paymentMethod: "cash", services: 10000 }])
  await expense("2026-02-02", 4000, "Equipment")
  assert.equal(await monthProfit("2026-02"), 6000)
})

// ===========================================================================
// 4. Changes after saving
// ===========================================================================

test("4a editing an expense's amount updates profit", async () => {
  fresh()
  await income("2026-03-01", [{ paymentMethod: "cash", services: 100 }])
  const id = await expense("2026-03-02", 40)
  await expensesSvc.updateExpense(BIZ, UID, id, { amount: 55 })
  assert.equal((await estimate()).ytdProfit, 45)
  assert.equal(await monthProfit("2026-03"), 45)
})

test("4b moving an expense to another month updates both months", async () => {
  fresh()
  await income("2026-03-01", [{ paymentMethod: "cash", services: 100 }])
  await income("2026-04-01", [{ paymentMethod: "cash", services: 100 }])
  const id = await expense("2026-03-02", 40)
  await expensesSvc.updateExpense(BIZ, UID, id, { date: "2026-04-02" })
  assert.equal(await monthProfit("2026-03"), 100)
  assert.equal(await monthProfit("2026-04"), 60)
  assert.equal((await estimate()).ytdProfit, 160)
})

test("4c deleting an expense restores profit", async () => {
  fresh()
  await income("2026-03-01", [{ paymentMethod: "cash", services: 100 }])
  const id = await expense("2026-03-02", 40)
  await expensesSvc.deleteExpense(BIZ, UID, id)
  assert.equal((await estimate()).ytdProfit, 100)
})

test("4d editing an income amount updates profit", async () => {
  fresh()
  const id = await income("2026-03-01", [{ paymentMethod: "cash", services: 100 }])
  await entriesSvc.updateEntry(BIZ, UID, id, {
    independent: { incomeBreakdowns: [{ paymentMethod: "cash", services: 250 }] },
  })
  assert.equal((await estimate()).ytdProfit, 250)
})

test("4e moving income to another month updates both months", async () => {
  fresh()
  const id = await income("2026-03-01", [{ paymentMethod: "cash", services: 100 }])
  await entriesSvc.updateEntry(BIZ, UID, id, { date: "2026-05-01" })
  assert.equal(await monthProfit("2026-03"), 0)
  assert.equal(await monthProfit("2026-05"), 100)
  assert.equal((await estimate()).ytdProfit, 100)
})

test("4f deleting income restores profit", async () => {
  fresh()
  await income("2026-03-01", [{ paymentMethod: "cash", services: 100 }])
  const id = await income("2026-03-02", [{ paymentMethod: "cash", services: 50 }])
  await entriesSvc.deleteEntry(BIZ, UID, id)
  assert.equal((await estimate()).ytdProfit, 100)
})

test("4g emptying a month removes it entirely, not just its newest record", async () => {
  fresh()
  const a = await income("2026-03-01", [{ paymentMethod: "cash", services: 100 }])
  const b = await expense("2026-03-02", 40)
  await entriesSvc.deleteEntry(BIZ, UID, a)
  await expensesSvc.deleteExpense(BIZ, UID, b)
  assert.equal(db.paths(`workspaces/${BIZ}/profitLossStatements/`).filter((p) => p.includes("2026-03")).length, 0)
  const r = await estimate()
  assert.equal(r.ytdProfit, 0)
  assert.equal(r.firstRecordDate, null)
})

test("4h moving a record into last year takes it out of this year", async () => {
  fresh()
  await income("2026-03-01", [{ paymentMethod: "cash", services: 100 }])
  const id = await expense("2026-01-05", 40)
  await expensesSvc.updateExpense(BIZ, UID, id, { date: "2025-12-30" })
  assert.equal((await estimate()).ytdProfit, 100)
})

// ===========================================================================
// 5. Several workspaces
// ===========================================================================

test("5a two businesses add together", async () => {
  fresh()
  addWorkspace("biz2")
  await income("2026-03-01", [{ paymentMethod: "cash", services: 100 }])
  await income("2026-03-01", [{ paymentMethod: "cash", services: 250 }], {}, "biz2")
  await expense("2026-03-02", 30, "Supplies", {}, "biz2")
  assert.equal((await estimate()).ytdProfit, 320)
})

test("5b an archived business is left out", async () => {
  fresh()
  addWorkspace("old", { status: "archived" })
  await income("2026-03-01", [{ paymentMethod: "cash", services: 100 }])
  db.seed("workspaces/old", { name: "old", type: "independent", status: "active" })
  await income("2026-03-01", [{ paymentMethod: "cash", services: 999 }], {}, "old")
  db.seed("workspaces/old", { name: "old", type: "independent", status: "archived" })
  assert.equal((await estimate()).ytdProfit, 100)
})

test("5c a workspace you're not a member of is left out", async () => {
  fresh()
  addWorkspace("theirs", { uid: "someoneElse" })
  db.seed(`users/someoneElse/memberships/theirs`, { role: "owner" })
  await income("2026-03-01", [{ paymentMethod: "cash", services: 100 }])
  await entriesSvc.createEntry("theirs", "someoneElse", {
    workspace: "independent",
    date: "2026-03-01",
    notes: "",
    clientMutationId: `m${++mutation}`,
    independent: { incomeBreakdowns: [{ paymentMethod: "cash", services: 999 }] },
  })
  assert.equal((await estimate()).ytdProfit, 100)
})

test("5d W-2 pay counts as wages, not business profit", async () => {
  fresh()
  addWorkspace("job", { type: "w2" })
  answerQuestions({ hasW2Job: null, w2AllRecorded: true, w2WorkspaceKey: "job" })
  await income("2026-01-05", [{ paymentMethod: "cash", services: 1000 }])
  db.seed("workspaces/job/entries/p1", {
    workspace: "w2",
    periodId: "2026-03",
    date: "2026-03-15",
    notes: "",
    w2: {},
    totals: { totalHours: 40, paidHours: 40, breakDeductionAmount: 0, customDeductionsAmount: 0, dayTotal: 2000, taxableTotal: 2000 },
  })
  const r = await estimate()
  assert.equal(r.ytdProfit, 1000)
  assert.ok(r.quarterly.annualized.w2Wages > 0, "W-2 pay should reach the estimate as wages")
  assert.ok(r.quarterly.job, "with W-2 pay the estimate is the business's share")
})

test("5d2 adding a W-2 workspace asks the W-2 question again", async () => {
  fresh()
  await income("2026-01-05", [{ paymentMethod: "cash", services: 1000 }])
  let r = await estimate()
  assert.ok(!issueCodes(r).includes("w2_unanswered"))
  addWorkspace("job", { type: "w2" })
  r = await estimate()
  assert.deepEqual(issueCodes(r), ["w2_unanswered"])
  assert.match(r.health.issues[0].message, /recorded in 521/)
  answerQuestions({ hasW2Job: null, w2AllRecorded: true, w2WorkspaceKey: "job" })
  r = await estimate()
  assert.deepEqual(issueCodes(r), [])
  // A second W-2 workspace changes the set: asked again.
  addWorkspace("job2", { type: "w2" })
  assert.deepEqual(issueCodes(await estimate()), ["w2_unanswered"])
})

test("5d4 W-2 tips need the job's line of work, then count toward the tips deduction", async () => {
  fresh()
  addWorkspace("job", { type: "w2" })
  answerQuestions({ hasW2Job: null, w2AllRecorded: true, w2WorkspaceKey: "job", occupationCode: null })
  await income("2026-01-05", [{ paymentMethod: "cash", services: 600 }])
  for (const month of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]) {
    db.seed(`workspaces/job/entries/p${month}`, {
      workspace: "w2",
      periodId: `2026-${month}`,
      date: `2026-${month}-15`,
      notes: "",
      w2: { tips: 1300, reportedCash: 0 },
      totals: { totalHours: 0, paidHours: 0, breakDeductionAmount: 0, customDeductionsAmount: 0, dayTotal: 1450, taxableTotal: 1450 },
    })
  }
  let r = await estimate()
  assert.deepEqual(issueCodes(r), ["missing_w2_occupation"])
  assert.equal(r.w2.workspaces[0].ytdTips, 13000)
  answerQuestions({ hasW2Job: null, w2AllRecorded: true, w2WorkspaceKey: "job", w2OccupationCode: "603" })
  r = await estimate()
  assert.deepEqual(issueCodes(r), [])
  // 1,450 a month, 1,300 of it tips: the job's tips are deducted, so the
  // job alone owes no income tax.
  assert.ok(r.quarterly.annualized.estimate.lines.tipsDeduction > 15000)
  assert.equal(r.quarterly.job.jobOnlyTax, 0)
})

test("5d3 W-2 pay not recorded in 521 is added in, spread over the year", async () => {
  fresh()
  answerQuestions({ hasW2Job: true, unrecordedW2Pay: 36000 })
  await income("2026-01-05", [{ paymentMethod: "cash", services: 1000 }])
  const r = await estimate()
  assert.deepEqual(issueCodes(r), [])
  // 3,000 a month; on Oct 27 (Q4, before the period ends) Jan–Oct is
  // 30,000 over 300 days × 365 = 36,500 — the same pace rule as recorded pay.
  assert.equal(r.quarterly.annualized.w2Wages, 36500)
  assert.ok(r.quarterly.job)
})

test("5e someone with only a W-2 job gets no estimate", async () => {
  db.reset()
  addWorkspace("job", { type: "w2" })
  const r = await getTaxEstimate(UID, DateTime.fromISO(`${TODAY}T12:00:00`, { zone: "America/Los_Angeles" }))
  assert.equal(r.eligible, false)
})

// ===========================================================================
// 6. Dates
// ===========================================================================

test("6a Dec 31 belongs to last year, Jan 1 to this year", async () => {
  fresh()
  await income("2025-12-31", [{ paymentMethod: "cash", services: 500 }])
  await income("2026-01-01", [{ paymentMethod: "cash", services: 100 }])
  const r = await estimate()
  assert.equal(r.ytdProfit, 100)
  assert.equal(r.firstRecordDate, "2026-01-01")
})

test("6b January 1–15 still estimates last year, with the whole year", async () => {
  fresh()
  answerQuestions({ taxYear: 2026 })
  await income("2026-02-01", [{ paymentMethod: "cash", services: 100 }])
  await income("2026-12-20", [{ paymentMethod: "cash", services: 200 }])
  await income("2027-01-05", [{ paymentMethod: "cash", services: 999 }])
  const r = await estimate("2027-01-10")
  assert.equal(r.taxYear, 2026)
  assert.equal(r.ytdProfit, 300)
})

test("6c on Jan 16 the new year starts fresh", async () => {
  fresh()
  await income("2026-12-20", [{ paymentMethod: "cash", services: 200 }])
  await income("2027-01-05", [{ paymentMethod: "cash", services: 50 }])
  const r = await getTaxEstimate(UID, DateTime.fromISO("2027-01-16T12:00:00", { zone: "America/Los_Angeles" }))
  assert.equal(r.taxYear, 2027)
  assert.equal(r.ytdProfit, 50)
})

test("6d Feb 29 in a leap year lands in February", async () => {
  fresh()
  await income("2028-02-29", [{ paymentMethod: "cash", services: 100 }])
  assert.equal(await monthProfit("2028-02"), 100)
  assert.equal(await monthProfit("2028-03"), 0)
})

test("6e a record dated after today's month waits until its month", async () => {
  fresh()
  await income("2026-03-01", [{ paymentMethod: "cash", services: 100 }])
  await income("2026-12-15", [{ paymentMethod: "cash", services: 5000 }])
  assert.equal((await estimate()).ytdProfit, 100)
})

test("6f first record date is the earliest of income, expenses and refunds, across businesses", async () => {
  fresh()
  addWorkspace("biz2")
  await income("2026-06-02", [{ paymentMethod: "cash", services: 100 }])
  await expense("2026-05-20", 10, "Supplies", {}, "biz2")
  assert.equal((await estimate()).firstRecordDate, "2026-05-20")
  await refund("2026-04-03", [{ paymentMethod: "cash", services: -5 }])
  assert.equal((await estimate()).firstRecordDate, "2026-04-03")
})

test("6g the business-started-then shortcut clears the missing-months block", async () => {
  fresh()
  await income("2026-06-02", [{ paymentMethod: "cash", services: 100 }])
  let r = await estimate()
  assert.ok(issueCodes(r).includes("missing_earlier_months"))
  answerQuestions({ businessStartDate: r.firstRecordDate })
  r = await estimate()
  assert.ok(!issueCodes(r).includes("missing_earlier_months"))
  assert.equal(r.health.canShowEstimate, true)
})

// ===========================================================================
// 7. Warning counts
// ===========================================================================

function seedPendingBank(count, workspaceId = BIZ) {
  for (let i = 0; i < count; i++) {
    db.seed(`workspaces/${workspaceId}/plaidPendingTransactions/p${i}`, { status: "pending" })
  }
  db.seed(`workspaces/${workspaceId}/plaidPendingTransactions/done`, { status: "confirmed" })
}

test("7a pending bank items are counted, confirmed ones are not", async () => {
  fresh()
  await income("2026-01-05", [{ paymentMethod: "cash", services: 100 }])
  seedPendingBank(3)
  const r = await estimate()
  assert.match(issue(r, "unreviewed_bank_deposits").message, /\b3 bank transactions\b/)
})

test("7b 9 unreviewed items warn; 10 block the estimate", async () => {
  fresh()
  await income("2026-01-05", [{ paymentMethod: "cash", services: 100 }])
  seedPendingBank(9)
  let r = await estimate()
  assert.equal(issue(r, "unreviewed_bank_deposits").severity, "warning")
  assert.equal(r.health.canShowEstimate, true)
  seedPendingBank(10)
  r = await estimate()
  assert.equal(issue(r, "unreviewed_bank_deposits").severity, "blocker")
  assert.equal(r.health.canShowEstimate, false)
})

test("7c pending bank items add up across businesses", async () => {
  fresh()
  addWorkspace("biz2")
  await income("2026-01-05", [{ paymentMethod: "cash", services: 100 }])
  seedPendingBank(6)
  seedPendingBank(5, "biz2")
  assert.equal(issue(await estimate(), "unreviewed_bank_deposits").severity, "blocker")
})

test("7d only unfinished imports count", async () => {
  fresh()
  await income("2026-01-05", [{ paymentMethod: "cash", services: 100 }])
  db.seed(`workspaces/${BIZ}/importBatches/a`, { status: "active", pendingCount: 4 })
  db.seed(`workspaces/${BIZ}/importBatches/b`, { status: "completed", pendingCount: 50 })
  db.seed(`workspaces/${BIZ}/importBatches/c`, { status: "archived", pendingCount: 50 })
  assert.match(issue(await estimate(), "unreviewed_imports").message, /\b4 imported items\b/)
})

test("7e uncategorized expenses are counted across months", async () => {
  fresh()
  await income("2026-01-05", [{ paymentMethod: "cash", services: 1000 }])
  seedUncategorizedExpense("u1", "2026-02-03", 10)
  seedUncategorizedExpense("u2", "2026-03-03", 10)
  await expense("2026-02-04", 1)
  await expense("2026-03-04", 1)
  assert.match(issue(await estimate(), "uncategorized_expenses").message, /\b2 expenses\b/)
})

test("7f clean records and answers: no warnings at all", async () => {
  fresh()
  await income("2026-01-05", [{ paymentMethod: "cash", services: 1000 }])
  await expense("2026-01-06", 100)
  const r = await estimate()
  assert.deepEqual(issueCodes(r), [])
  assert.equal(r.health.status, "ready")
})

// ---------------------------------------------------------------------------

;(async () => {
  let failed = 0
  for (const { name, fn } of tests) {
    warnings.length = 0
    try {
      await fn()
      const syncWarnings = warnings.filter((w) => /profit loss sync failed/.test(w))
      if (syncWarnings.length) throw new Error(`P&L sync failed: ${syncWarnings[0]}`)
      console.log(`  ok  ${name}`)
    } catch (err) {
      failed++
      console.log(`FAIL  ${name}`)
      console.log(String(err?.stack ?? err).split("\n").slice(0, 6).join("\n").replace(/^/gm, "      "))
    }
  }
  console.log(failed ? `\n${failed} of ${tests.length} failed` : `\nall ${tests.length} tests passed`)
  process.exit(failed ? 1 : 0)
})()
