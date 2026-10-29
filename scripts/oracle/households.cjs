// Tax audit, part 2: the households compared against PolicyEngine, and our
// own numbers for each. Shared by build-inputs.cjs, compare.cjs and the
// regular test (scripts/test-tax-oracle.cjs).
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
})

const { computeFederalEstimate } = require("../../shared/estimatedTax/calculate.ts")
const { computeStateTax } = require("../../shared/estimatedTax/states.ts")
const { getEstimatedTaxYear, SUPPORTED_ESTIMATED_TAX_YEARS } = require("../../shared/estimatedTax/years/index.ts")
const { TIPPED_OCCUPATIONS } = require("../../shared/estimatedTax/tippedOccupations.ts")

// The year to build households for: TAX_YEAR=2027, or the newest year
// that's turned on (docs/tax-yearly-update.md).
const YEAR = Number(process.env.TAX_YEAR) || Math.max(...SUPPORTED_ESTIMATED_TAX_YEARS)
const TABLE = getEstimatedTaxYear(YEAR)
if (!TABLE) throw new Error(`No tax table for ${YEAR} is turned on (shared/estimatedTax/years/index.ts)`)
const FILING_STATUSES = ["single", "marriedJoint", "marriedSeparate", "headOfHousehold"]
// States the estimate includes: no-tax states and the flat-rate ones.
const STATES = Object.keys(TABLE.states)
// Tipped occupations with no specified-service question, so both sides
// should apply the deduction.
const PLAIN_TIP_OCCUPATIONS = TIPPED_OCCUPATIONS.filter((o) => !o.specifiedServiceRisk).map((o) => o.code)

// Deterministic, so a case id always means the same household.
function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const dollars = (n) => Math.round(n)

function randomHousehold(rand, id) {
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const filingStatus = pick(FILING_STATUSES)
  // Profit: mostly $0–150k, some losses, some high earners.
  const r = rand()
  const profit =
    r < 0.08 ? -dollars(rand() * 20_000) : r < 0.85 ? dollars(rand() * 150_000) : dollars(150_000 + rand() * 250_000)
  const w2Wages = rand() < 0.6 ? 0 : dollars(rand() * 250_000)
  const children = filingStatus === "headOfHousehold" ? 1 + Math.floor(rand() * 4) : rand() < 0.5 ? 0 : Math.floor(rand() * 5)
  const hasTips = profit > 0 && rand() < 0.3
  const tips = hasTips ? dollars(Math.min(profit, rand() * 40_000)) : 0
  // Tips at a W-2 job, part of the W-2 pay (one line of work per person, as
  // PolicyEngine takes one occupation code).
  const w2Tips = w2Wages > 0 && rand() < 0.3 ? dollars(rand() * Math.min(w2Wages, 40_000)) : 0
  const occupationCode = hasTips || w2Tips ? pick(PLAIN_TIP_OCCUPATIONS) : null
  return {
    id,
    filingStatus,
    profit,
    w2Wages,
    children,
    tips,
    w2Tips,
    occupationCode,
    stateCode: pick(STATES),
  }
}

// The smallest profit at which f(profit) reaches target (f rises with profit).
function profitFor(f, target) {
  let lo = 0
  let hi = 2_000_000
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) < target) lo = mid
    else hi = mid
  }
  return Math.ceil(hi)
}

// Hand-picked: just either side of each line where the rules change.
function edgeHouseholds() {
  const out = []
  const add = (label, h) => out.push({ id: `edge-${out.length + 1}`, label, w2Wages: 0, w2Tips: 0, children: 0, tips: 0, occupationCode: null, stateCode: "TX", ...h })
  for (const filingStatus of FILING_STATUSES) {
    const taxable = (profit) => ours({ filingStatus, profit, w2Wages: 0, children: 0, tips: 0, occupationCode: null }).federal.lines.taxableIncome
    for (const bracket of TABLE.federal[filingStatus].brackets) {
      if (bracket.upTo == null) continue
      const at = profitFor(taxable, bracket.upTo)
      for (const delta of [-2, 0, 2]) add(`${filingStatus} bracket at ${bracket.upTo} (${delta})`, { filingStatus, profit: at + delta })
    }
    const ctcThreshold = TABLE.childTaxCredit.phaseOutThreshold[filingStatus]
    for (const over of [-1, 1, 999, 1001, 40_000]) {
      add(`${filingStatus} child credit phase-out ${over}`, { filingStatus, profit: 0, w2Wages: ctcThreshold + over, children: 2 })
    }
    const qbiThreshold = TABLE.qbi.threshold[filingStatus]
    const beforeQbi = (profit) => ours({ filingStatus, profit, w2Wages: 0, children: 0, tips: 0, occupationCode: null }).federal.lines.taxableIncomeBeforeQbi
    const atQbi = profitFor(beforeQbi, qbiThreshold)
    for (const delta of [-5, 0]) add(`${filingStatus} QBI threshold (${delta})`, { filingStatus, profit: atQbi + delta })
    const amt = TABLE.additionalMedicare.threshold[filingStatus]
    for (const delta of [-1, 1, 50_000]) add(`${filingStatus} Additional Medicare ${delta}`, { filingStatus, profit: 0, w2Wages: amt + delta })
    add(`${filingStatus} Additional Medicare on SE`, { filingStatus, profit: amt + 60_000 })
    const tipStart = TABLE.tipsDeduction.phaseOutThreshold[filingStatus]
    if (tipStart != null) {
      for (const over of [0, 500, 1_000, 1_500, 100_000]) {
        add(`${filingStatus} tips phase-out ${over}`, { filingStatus, profit: 30_000, w2Wages: tipStart + over, tips: 20_000, occupationCode: "102" })
      }
    }
  }
  const base = TABLE.selfEmployment.socialSecurityWageBase
  for (const w2Wages of [0, base - 10_000, base, base + 10_000]) add(`SS wage base, W-2 ${w2Wages}`, { filingStatus: "single", profit: 60_000, w2Wages })
  add("SS cap on SE alone", { filingStatus: "single", profit: Math.ceil(base / TABLE.selfEmployment.netEarningsFactor) + 1000 })
  // $400 of net earnings = $433.14 of profit.
  for (const profit of [432, 433, 434, 435, 1_000]) add(`$400 SE floor, profit ${profit}`, { filingStatus: "single", profit })
  for (const profit of [999, 1_000, 1_500, 2_500]) add(`QBI minimum, profit ${profit}`, { filingStatus: "single", profit, w2Wages: 30_000 })
  add("loss offsets W-2", { filingStatus: "single", profit: -15_000, w2Wages: 60_000 })
  add("tips over the cap", { filingStatus: "single", profit: 60_000, tips: 40_000, occupationCode: "101" })
  // W-2 tips (a stylist with a salon job and a side business, Oct 2026)
  add("W-2 tips: the user's own screen", { filingStatus: "single", profit: 7_623, tips: 707, w2Wages: 17_879, w2Tips: 16_179, occupationCode: "603" })
  add("W-2 tips over the cap", { filingStatus: "single", profit: 5_000, w2Wages: 60_000, w2Tips: 35_000, occupationCode: "102" })
  add("W-2 and business tips together over the cap", { filingStatus: "marriedJoint", profit: 30_000, tips: 15_000, w2Wages: 40_000, w2Tips: 15_000, occupationCode: "102", children: 1 })
  add("W-2 tips, married separately", { filingStatus: "marriedSeparate", profit: 10_000, w2Wages: 30_000, w2Tips: 10_000, occupationCode: "101" })
  for (const over of [0, 999, 1_000, 20_000]) {
    add(`W-2 tips phase-out ${over}`, { filingStatus: "single", profit: 10_000, w2Wages: 150_000 + over, w2Tips: 20_000, occupationCode: "101" })
  }
  for (const stateCode of STATES) {
    for (const filingStatus of FILING_STATUSES) {
      add(`${stateCode} ${filingStatus}`, { filingStatus, profit: 55_000, w2Wages: 20_000, children: filingStatus === "headOfHousehold" ? 2 : 1, stateCode })
    }
    add(`${stateCode} loss with W-2`, { filingStatus: "single", profit: -8_000, w2Wages: 45_000, stateCode })
  }
  return out
}

function buildHouseholds({ randomCount = 5000, seed = 2026 } = {}) {
  const rand = mulberry32(seed)
  const random = Array.from({ length: randomCount }, (_, i) => randomHousehold(rand, `r-${i + 1}`))
  return [...edgeHouseholds(), ...random]
}

// Our numbers for one household, as the app computes them.
function ours(h, table = TABLE) {
  const federal = computeFederalEstimate(table, {
    filingStatus: h.filingStatus,
    selfEmploymentProfit: h.profit,
    w2Wages: h.w2Wages,
    qualifyingChildren: h.children,
    tips: { amount: h.tips, occupationCode: h.occupationCode },
    w2Tips: { amount: h.w2Tips ?? 0, occupationCode: h.occupationCode },
  })
  const state = h.stateCode
    ? computeStateTax(table.states, h.stateCode, {
        filingStatus: h.filingStatus,
        federalAgi: federal.lines.adjustedGrossIncome,
        selfEmploymentTaxDeduction: federal.lines.selfEmploymentTaxDeduction,
        selfEmploymentProfit: h.profit,
        w2Wages: h.w2Wages,
        qualifyingChildren: h.children,
      })
    : null
  return { federal, state }
}

// The lines compared, ours → PolicyEngine's name for the same thing.
const LINES = [
  { key: "selfEmploymentTax", ours: (o) => o.federal.lines.selfEmploymentTax, pe: "self_employment_tax" },
  { key: "selfEmploymentTaxDeduction", ours: (o) => o.federal.lines.selfEmploymentTaxDeduction, pe: "self_employment_tax_ald" },
  { key: "additionalMedicareTax", ours: (o) => o.federal.lines.additionalMedicareTax, pe: "additional_medicare_tax" },
  { key: "adjustedGrossIncome", ours: (o) => o.federal.lines.adjustedGrossIncome, pe: "adjusted_gross_income" },
  { key: "standardDeduction", ours: (o) => o.federal.lines.standardDeduction, pe: "standard_deduction" },
  { key: "tipsDeduction", ours: (o) => o.federal.lines.tipsDeduction, pe: "tip_income_deduction" },
  { key: "qbiDeduction", ours: (o) => o.federal.lines.qbiDeduction, pe: "qualified_business_income_deduction" },
  { key: "taxableIncome", ours: (o) => o.federal.lines.taxableIncome, pe: "taxable_income" },
  { key: "incomeTaxBeforeCredits", ours: (o) => o.federal.lines.incomeTaxBeforeCredits, pe: "income_tax_main_rates" },
  // PolicyEngine's credit before the tax-owed limit; ours is only the part
  // that lowers income tax, so compare against the same limit.
  { key: "childTaxCredit", ours: (o) => o.federal.lines.childTaxCredit, pe: "ctc_limited" },
  { key: "stateTax", ours: (o) => (o.state && (o.state.status === "included" || o.state.status === "none") ? o.state.tax : null), pe: "state_tax_before_credits" },
]

module.exports = { YEAR, TABLE, buildHouseholds, ours, LINES }

if (require.main === module) {
  const fs = require("node:fs")
  const path = require("node:path")
  const households = buildHouseholds()
  const file = path.join(__dirname, "inputs.json")
  fs.writeFileSync(file, JSON.stringify({ year: YEAR, households }, null, 0))
  console.log(`wrote ${households.length} households to ${path.relative(process.cwd(), file)}`)
}
