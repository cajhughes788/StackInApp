// Tax audit, part 3: rules that must hold for every household, checked on
// thousands of random ones (fixed seed, so a failure always repeats). When
// a rule breaks, the household is shrunk to the simplest one that still
// breaks it. Usage: node scripts/test-tax-rules.cjs [runs per rule]
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
})

const { computeFederalEstimate } = require("../shared/estimatedTax/calculate.ts")
const { computeStateTax } = require("../shared/estimatedTax/states.ts")
const { computeQuarterlyEstimate } = require("../shared/estimatedTax/quarterly.ts")
const { assessTaxDataHealth } = require("../shared/estimatedTax/dataHealth.ts")
const { getEstimatedTaxYear } = require("../shared/estimatedTax/years/index.ts")
const { TIPPED_OCCUPATIONS } = require("../shared/estimatedTax/tippedOccupations.ts")
const { computeSafeToSpend } = require("../shared/taxSetAside.ts")

const T = getEstimatedTaxYear(2026)
const RUNS = Number(process.argv[2]) || 10_000
const FILING_STATUSES = ["single", "marriedJoint", "marriedSeparate", "headOfHousehold"]
const STATES = Object.keys(T.states)
const PLAIN_TIP_CODES = TIPPED_OCCUPATIONS.filter((o) => !o.specifiedServiceRisk).map((o) => o.code)
const CENT = 0.005 // float slack when comparing rounded amounts

// ---------------------------------------------------------------------------
// Random households
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Amounts cluster where the rules change (small, around the thresholds)
// as well as spreading up to high earners.
function amount(rand, max) {
  const r = rand()
  if (r < 0.1) return 0
  if (r < 0.25) return Math.round(rand() * 2_000 * 100) / 100
  if (r < 0.7) return Math.round(rand() * 150_000)
  return Math.round(rand() * max)
}

function randomHousehold(rand) {
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const profit = rand() < 0.08 ? -amount(rand, 50_000) : amount(rand, 700_000)
  const hasTips = profit > 0 && rand() < 0.3
  const w2Wages = rand() < 0.6 ? 0 : amount(rand, 400_000)
  const w2Tips = w2Wages > 0 && rand() < 0.3 ? Math.round(rand() * Math.min(w2Wages, 40_000)) : 0
  return {
    filingStatus: pick(FILING_STATUSES),
    profit,
    w2Wages,
    w2Tips,
    w2OccupationCode: w2Tips ? pick([...PLAIN_TIP_CODES, "none"]) : null,
    children: rand() < 0.5 ? 0 : Math.floor(rand() * 5),
    tips: hasTips ? Math.round(Math.min(profit, rand() * 40_000)) : 0,
    occupationCode: hasTips ? pick(PLAIN_TIP_CODES) : null,
    stateCode: pick(STATES),
  }
}

function federal(h) {
  return computeFederalEstimate(T, {
    filingStatus: h.filingStatus,
    selfEmploymentProfit: h.profit,
    w2Wages: h.w2Wages,
    qualifyingChildren: h.children,
    tips: { amount: h.tips, occupationCode: h.occupationCode },
    w2Tips: { amount: h.w2Tips ?? 0, occupationCode: h.w2OccupationCode ?? null },
  })
}

function state(h, fed = federal(h)) {
  const result = computeStateTax(T.states, h.stateCode, {
    filingStatus: h.filingStatus,
    federalAgi: fed.lines.adjustedGrossIncome,
    selfEmploymentTaxDeduction: fed.lines.selfEmploymentTaxDeduction,
    selfEmploymentProfit: h.profit,
    w2Wages: h.w2Wages,
    qualifyingChildren: h.children,
  })
  return result.status === "included" ? result.tax : 0
}

// Federal (income + SE + Additional Medicare) plus state.
function totalTax(h) {
  const fed = federal(h)
  return fed.totalTax + state(h, fed)
}

// ---------------------------------------------------------------------------
// Shrinking: try simpler versions of a failing household; keep any that
// still fail, until nothing simpler does.
// ---------------------------------------------------------------------------

function simpler(h) {
  const out = []
  if (h.tips) out.push({ ...h, tips: 0, occupationCode: null })
  if (h.w2Tips) out.push({ ...h, w2Tips: 0, w2OccupationCode: null })
  if (h.w2Wages) out.push({ ...h, w2Wages: 0, w2Tips: 0, w2OccupationCode: null })
  if (h.children) out.push({ ...h, children: 0 }, { ...h, children: h.children - 1 })
  if (h.stateCode !== "TX") out.push({ ...h, stateCode: "TX" })
  if (h.filingStatus !== "single") out.push({ ...h, filingStatus: "single" })
  for (const key of ["profit", "w2Wages", "tips"]) {
    const v = h[key]
    if (!v) continue
    for (const step of [10_000, 1_000, 100, 1]) {
      const rounded = Math.round(v / step) * step
      if (rounded !== v && (key !== "tips" || rounded <= h.profit) && (key !== "w2Wages" || rounded >= (h.w2Tips ?? 0))) {
        out.push({ ...h, [key]: rounded })
      }
    }
  }
  return out
}

function shrink(h, fails) {
  let current = h
  for (let guard = 0; guard < 200; guard++) {
    const next = simpler(current).find((candidate) => {
      try {
        return fails(candidate)
      } catch {
        return false
      }
    })
    if (!next) break
    current = next
  }
  return current
}

const describe = (h) =>
  `${h.filingStatus}, profit ${h.profit}, W-2 ${h.w2Wages}${h.w2Tips ? ` (tips ${h.w2Tips}, ${h.w2OccupationCode})` : ""}, ${h.children} kids, tips ${h.tips}${h.tips ? ` (${h.occupationCode})` : ""}, ${h.stateCode}`

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

let failures = 0
let seed = 1

// rule(h) returns null when it holds, or a short explanation when it breaks.
function rule(name, check, { generate = randomHousehold, describeCase = describe, shrinkable = true } = {}) {
  const rand = mulberry32(seed++)
  for (let i = 0; i < RUNS; i++) {
    const h = generate(rand)
    const problem = check(h)
    if (problem == null) continue
    const smallest = shrinkable ? shrink(h, (c) => check(c) != null) : h
    failures++
    console.log(`FAIL  ${name}`)
    console.log(`      ${describeCase(smallest)}`)
    console.log(`      ${check(smallest)}`)
    return
  }
  console.log(`  ok  ${name}`)
}

const money = (n) => `$${n.toFixed(2)}`

console.log(`tax rules — ${RUNS.toLocaleString()} random households each\n`)

// ===========================================================================
// Earning and owing
// ===========================================================================

rule("1. earning more never lowers total tax", (h) => {
  const before = totalTax(h)
  const after = totalTax({ ...h, profit: h.profit + 1_000 })
  return after < before - CENT ? `$1,000 more profit: tax ${money(before)} → ${money(after)}` : null
})

// Steps are real law: the child credit drops $50 for each $1,000 (or part)
// over its threshold, and the tips deduction $100 per full $1,000 — so $1
// can cost more than $1 at a step. Over $1,000 the steps even out. One
// true cliff stays: Illinois takes away the whole exemption once federal
// AGI passes $250,000 ($500,000 joint), so crossing it is skipped here.
function crossesIllinoisExemptionCliff(before, after) {
  if (before.stateCode !== "IL") return false
  const limit = T.states.IL.exemptionAgiLimit[before.filingStatus]
  const agi = (h) => federal(h).lines.adjustedGrossIncome
  return agi(before) <= limit && agi(after) > limit
}

function costOfRaise(h, key) {
  const raised = { ...h, [key]: h[key] + 1_000 }
  if (crossesIllinoisExemptionCliff(h, raised)) return null
  const cost = totalTax(raised) - totalTax(h)
  return cost > 1_000 + CENT ? `$1,000 more ${key === "profit" ? "profit" : "W-2 pay"} costs ${money(cost)}` : null
}

rule("2. earning $1,000 more never costs more than $1,000 in tax", (h) => costOfRaise(h, "profit"))

rule("2b. a $1,000 raise at the W-2 job never costs more than the raise", (h) => costOfRaise(h, "w2Wages"))

const NON_NEGATIVE = [
  "socialSecurityTax", "medicareTax", "selfEmploymentTax", "selfEmploymentTaxDeduction", "additionalMedicareTax",
  "standardDeduction", "tipsDeduction", "taxableIncomeBeforeQbi", "qualifiedBusinessIncome", "qbiDeduction",
  "taxableIncome", "incomeTaxBeforeCredits", "childTaxCredit", "incomeTax",
]
rule("3. no tax line is negative, and every line is whole cents", (h) => {
  const fed = federal(h)
  for (const key of NON_NEGATIVE) if (fed.lines[key] < 0) return `${key} is ${fed.lines[key]}`
  for (const [key, value] of Object.entries(fed.lines)) {
    if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) return `${key} is ${value}, not whole cents`
  }
  if (Math.abs(fed.totalTax * 100 - Math.round(fed.totalTax * 100)) > 1e-6) return `totalTax is ${fed.totalTax}`
  const st = state(h, fed)
  return st < 0 ? `state tax is ${st}` : null
})

rule("4. a loss means no self-employment tax and no business-income deduction", (h) => {
  const fed = federal({ ...h, profit: -Math.abs(h.profit), tips: 0, occupationCode: null })
  if (fed.lines.selfEmploymentTax !== 0) return `SE tax ${fed.lines.selfEmploymentTax} on a loss`
  return fed.lines.qbiDeduction !== 0 ? `QBI deduction ${fed.lines.qbiDeduction} on a loss` : null
})

// ===========================================================================
// Household situation
// ===========================================================================

rule("5. more children never raise tax", (h) => {
  const before = totalTax(h)
  const after = totalTax({ ...h, children: h.children + 1 })
  return after > before + CENT ? `one more child: ${money(before)} → ${money(after)}` : null
})

const asStatus = (h, filingStatus) => totalTax({ ...h, filingStatus })

rule("6. head of household never pays more than single", (h) => {
  const single = asStatus(h, "single")
  const hoh = asStatus(h, "headOfHousehold")
  return hoh > single + CENT ? `single ${money(single)}, head of household ${money(hoh)}` : null
})

rule("7. single never pays more than married filing separately", (h) => {
  const single = asStatus(h, "single")
  const separate = asStatus(h, "marriedSeparate")
  return single > separate + CENT ? `single ${money(single)}, married separately ${money(separate)}` : null
})

rule("8. married filing jointly (no spouse income) never pays more than single", (h) => {
  const single = asStatus(h, "single")
  const joint = asStatus(h, "marriedJoint")
  return joint > single + CENT ? `single ${money(single)}, married jointly ${money(joint)}` : null
})

rule("9. qualifying tips inside the same profit never raise tax", (h) => {
  if (h.profit <= 0) return null
  const without = totalTax({ ...h, tips: 0, occupationCode: null })
  const tips = h.tips || Math.round(Math.min(h.profit, 25_000) / 2)
  const withTips = totalTax({ ...h, tips, occupationCode: h.occupationCode ?? "102" })
  return withTips > without + CENT ? `tips ${tips}: ${money(without)} without → ${money(withTips)} with` : null
})

// ===========================================================================
// State
// ===========================================================================

rule("10. state tax is never negative or more than the rate × income", (h) => {
  const st = state(h)
  const rule = T.states[h.stateCode]
  if (st < 0) return `state tax ${st}`
  if (rule.kind === "none") return st === 0 ? null : `no-tax state charged ${st}`
  const income = Math.max(0, h.profit) + Math.max(0, h.w2Wages)
  // The tax is rounded to the cent (half-up), so allow that cent.
  return st > rule.rate * income + 0.01 ? `state tax ${money(st)} > ${rule.rate} × ${income}` : null
})

// ===========================================================================
// Quarterly payments
// ===========================================================================

const TODAYS = ["2026-02-10", "2026-04-10", "2026-05-20", "2026-06-05", "2026-08-15", "2026-09-10", "2026-10-27", "2026-12-20", "2027-01-08"]

function randomYear(rand) {
  const h = randomHousehold(rand)
  const today = TODAYS[Math.floor(rand() * TODAYS.length)]
  const lastMonth = today.startsWith("2027") ? 12 : Number(today.slice(5, 7))
  // A monthly pattern: steady, seasonal or lumpy.
  const shape = Math.floor(rand() * 3)
  const months = Array.from({ length: lastMonth }, (_, i) => {
    const factor = shape === 0 ? 1 : shape === 1 ? 0.5 + Math.sin(i / 2) ** 2 : rand() * 2
    return {
      month: `2026-${String(i + 1).padStart(2, "0")}`,
      profit: Math.round((h.profit / 12) * factor * 100) / 100,
      w2Wages: Math.round((h.w2Wages / 12) * 100) / 100,
      tips: Math.round((h.tips / 12) * factor * 100) / 100,
    }
  })
  const priorYearTax = rand() < 0.4 ? null : amount(rand, 150_000)
  return {
    h,
    input: {
      today,
      filingStatus: h.filingStatus,
      qualifyingChildren: h.children,
      months,
      priorYearTax,
      priorYearAgi: priorYearTax == null ? null : amount(rand, 500_000),
      ytdWithholding: h.w2Wages > 0 && rand() < 0.5 ? Math.round(rand() * h.w2Wages * 0.15) : null,
      withholdingAsOf: "2026-06-30",
      estimatedPaymentsMade: rand() < 0.5 ? 0 : amount(rand, 30_000),
      occupationCode: h.occupationCode,
      stateCode: h.stateCode,
    },
  }
}
const describeYear = ({ input }) =>
  `${input.filingStatus}, ${input.qualifyingChildren} kids, today ${input.today}, profit by month [${input.months.map((m) => m.profit).join(", ")}], W-2/mo ${input.months[0]?.w2Wages ?? 0}, tips/mo ${input.months[0]?.tips ?? 0}, withheld ${input.ytdWithholding}, last year's tax ${input.priorYearTax}, paid ${input.estimatedPaymentsMade}, ${input.stateCode}`
const yearRule = (name, check) => rule(name, check, { generate: randomYear, describeCase: describeYear, shrinkable: false })

yearRule("11. the set-aside amount is never negative or more than the year's tax", ({ input }) => {
  const r = computeQuarterlyEstimate(T, input)
  if (r.basedOnEarnings < 0) return `set aside ${r.basedOnEarnings}`
  const yearTax = r.annualized.estimate.totalTax
  return r.basedOnEarnings > yearTax + CENT ? `set aside ${money(r.basedOnEarnings)} > year's tax ${money(yearTax)}` : null
})

yearRule("12. recording a payment lowers what's due by exactly that, down to $0", ({ input, h }) => {
  const paid = 1_234.56
  const before = computeQuarterlyEstimate(T, input)
  const after = computeQuarterlyEstimate(T, { ...input, estimatedPaymentsMade: input.estimatedPaymentsMade + paid })
  const expect = (a, b) => Math.round(Math.max(0, a - paid) * 100) / 100 === b
  if (!before.belowEstimatesThreshold && !expect(before.basedOnEarnings, after.basedOnEarnings)) {
    return `set aside ${before.basedOnEarnings} → ${after.basedOnEarnings} after paying ${paid}`
  }
  if (before.penaltyFree != null && !expect(before.penaltyFree, after.penaltyFree)) {
    return `penalty-free ${before.penaltyFree} → ${after.penaltyFree} after paying ${paid}`
  }
  return null
})

yearRule("13. the penalty-free amount is never more than 110% of last year's tax", ({ input }) => {
  const r = computeQuarterlyEstimate(T, input)
  if (r.penaltyFree == null) return null
  // 110% is rounded to the cent (half-up), so allow that cent.
  return r.penaltyFree > input.priorYearTax * 1.1 + 0.01 ? `penalty-free ${money(r.penaltyFree)} vs last year ${input.priorYearTax}` : null
})

yearRule("14. with steady income, each quarter's running total never drops", ({ input }) => {
  const monthly = Math.abs(input.months[0]?.profit ?? 1000) || 1000
  const steady = (through) => Array.from({ length: through }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, profit: monthly, w2Wages: 0 }))
  const base = { ...input, priorYearTax: null, priorYearAgi: null, estimatedPaymentsMade: 0 }
  const due = [
    computeQuarterlyEstimate(T, { ...base, today: "2026-04-10", months: steady(3) }),
    computeQuarterlyEstimate(T, { ...base, today: "2026-06-05", months: steady(5) }),
    computeQuarterlyEstimate(T, { ...base, today: "2026-09-05", months: steady(8) }),
    computeQuarterlyEstimate(T, { ...base, today: "2027-01-05", months: steady(12) }),
  ].map((r) => r.basedOnEarnings)
  for (let q = 1; q < 4; q++) if (due[q] < due[q - 1] - CENT) return `Q${q} ${money(due[q - 1])} → Q${q + 1} ${money(due[q])} at ${monthly}/month`
  return null
})

yearRule("11b. the tax to cover is never negative or more than the whole tax; it's all of it without W-2 pay", ({ input }) => {
  const r = computeQuarterlyEstimate(T, input)
  const whole = r.annualized.estimate.totalTax
  if (r.businessTax < 0 || r.businessTax > whole + CENT) return `tax to cover ${money(r.businessTax)} of ${money(whole)}`
  const hasW2 = input.months.some((m) => m.w2Wages > 0)
  if (!hasW2 && (r.method !== "whole" || Math.abs(r.businessTax - whole) > CENT)) return `no W-2 pay, but ${r.method} ${money(r.businessTax)} ≠ ${money(whole)}`
  if (r.method === "business_share" && r.penaltyFree != null) return "last year's whole-return amount used with the business-share method"
  if (hasW2 && (r.method === "withholding") !== (input.ytdWithholding > 0)) return `method ${r.method} with withholding ${input.ytdWithholding}`
  return null
})

yearRule("15. the range's low end is never above its high end", ({ input }) => {
  const r = computeQuarterlyEstimate(T, input)
  if (r.range.low > r.range.high) return `federal ${r.range.low} > ${r.range.high}`
  return r.state.low > r.state.high ? `state ${r.state.low} > ${r.state.high}` : null
})

// ===========================================================================
// Safe to spend and warnings
// ===========================================================================

yearRule("16. safe to spend never exceeds profit; its tax share stays within 0–60%", ({ input }) => {
  const r = computeQuarterlyEstimate(T, input)
  if (r.businessTaxRate == null) return null
  // Under ~$1,000 of profit a single $50 child-credit step can be most of
  // the tax on it, so the share can run high on a few dollars; skip those.
  if (r.businessTaxRate < 0) return `business tax rate ${(r.businessTaxRate * 100).toFixed(1)}%`
  if (r.annualized.profit >= 1_000 && r.businessTaxRate > 0.6) return `business tax rate ${(r.businessTaxRate * 100).toFixed(1)}%`
  const income = Math.max(0, input.months.reduce((s, m) => s + m.profit, 0)) + 500
  const { profit, safeToSpend } = computeSafeToSpend(income, 500, r.businessTaxRate * 100)
  return safeToSpend > profit + CENT ? `safe to spend ${safeToSpend} > profit ${profit}` : null
})

function randomHealth(rand) {
  const maybe = (value) => (rand() < 0.3 ? null : value)
  const count = () => (rand() < 0.5 ? 0 : Math.floor(rand() * 15))
  return {
    today: "2026-10-27",
    taxYear: 2026,
    hasTaxYearTable: true,
    profile: {
      filingStatus: maybe(FILING_STATUSES[Math.floor(rand() * 4)]),
      qualifyingChildren: maybe(Math.floor(rand() * 3)),
      businessStartDate: rand() < 0.2 ? "2026-06-02" : null,
      situation: {
        spouseHasIncome: maybe(rand() < 0.2),
        investmentOrRentalIncome: maybe(rand() < 0.2),
        itemizesDeductions: maybe(rand() < 0.2),
      },
      priorYearTax: maybe(Math.round(rand() * 20_000)),
      stateCode: maybe("TX"),
      w2: { hasW2Workspace: rand() < 0.4, answered: rand() < 0.7 },
      tipsNeedOccupation: rand() < 0.2,
      confirmedComplete: rand() < 0.7,
    },
    firstRecordDate: rand() < 0.1 ? null : `2026-${String(1 + Math.floor(rand() * 9)).padStart(2, "0")}-15`,
    uncategorizedExpenseCount: count(),
    pendingBankReviewCount: count(),
    pendingImportCount: count(),
    reversedExpenseCount: count(),
  }
}
const describeHealth = (input) => JSON.stringify(input)
const blockers = (input) => new Set(assessTaxDataHealth(input).issues.filter((i) => i.severity === "blocker").map((i) => i.code))

rule(
  "17a. answering a question (No, 0, a filing status) never adds a blocker",
  (input) => {
    const before = blockers(input)
    const s = input.profile.situation
    const answered = {
      ...input,
      profile: {
        ...input.profile,
        filingStatus: input.profile.filingStatus ?? "single",
        qualifyingChildren: input.profile.qualifyingChildren ?? 0,
        stateCode: input.profile.stateCode ?? "TX",
        w2: { ...input.profile.w2, answered: true },
        tipsNeedOccupation: false,
        confirmedComplete: true,
        situation: {
          spouseHasIncome: s.spouseHasIncome ?? false,
          investmentOrRentalIncome: s.investmentOrRentalIncome ?? false,
          itemizesDeductions: s.itemizesDeductions ?? false,
        },
      },
    }
    const added = [...blockers(answered)].filter((code) => !before.has(code))
    return added.length ? `answering added: ${added.join(", ")}` : null
  },
  { generate: randomHealth, describeCase: describeHealth, shrinkable: false }
)

rule(
  "17b. more unreviewed items never unblock the estimate",
  (input) => {
    const before = assessTaxDataHealth(input).canShowEstimate
    const worse = {
      ...input,
      uncategorizedExpenseCount: input.uncategorizedExpenseCount + 3,
      pendingBankReviewCount: input.pendingBankReviewCount + 3,
      pendingImportCount: input.pendingImportCount + 3,
      reversedExpenseCount: input.reversedExpenseCount + 3,
    }
    return !before && assessTaxDataHealth(worse).canShowEstimate ? "more problems unblocked the estimate" : null
  },
  { generate: randomHealth, describeCase: describeHealth, shrinkable: false }
)

console.log(failures ? `\n${failures} rule(s) broken` : "\nall rules hold")
process.exit(failures ? 1 : 0)
