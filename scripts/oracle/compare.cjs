// Tax audit, part 2: compare our numbers with PolicyEngine's, line by line,
// and group the differences so each cause shows once.
// Usage: node scripts/oracle/compare.cjs [results.json]
const fs = require("node:fs")
const path = require("node:path")
const { ours, LINES } = require("./households.cjs")

const TOLERANCE = 1 // dollars


// Why a line differs. "expected" = a deliberate choice in our estimate
// (documented where it's made); "bug" = ours is wrong and needs a fix.
// The first cause that fits wins; anything left is "unexplained".
const CAUSES = [
  {
    cause: "PolicyEngine itemizes (state tax as SALT); we assume the standard deduction",
    kind: "expected",
    applies: (h, o, line, pe) => pe.tax_unit_itemizes === 1 && line !== "stateTax",
  },
  {
    cause: "Above the QBI threshold: no wages or property assumed, with a warning",
    kind: "expected",
    applies: (h, o) => o.federal.unsupported.includes("qbi_above_threshold"),
  },
  {
    cause: "Self-employed tips held to business net income (cautious reading)",
    kind: "expected",
    applies: (h, o) => h.tips > 0 && h.tips > o.federal.lines.qualifiedBusinessIncome,
  },
  {
    cause: "Tips phase-out reduces the $25,000 ceiling instead of the deduction (§224(b)(2))",
    kind: "bug",
    applies: (h, o, line, pe, diff, table) => {
      const start = table.tipsDeduction?.phaseOutThreshold[h.filingStatus]
      return line !== "stateTax" && h.tips > 0 && start != null && o.federal.lines.adjustedGrossIncome > start
    },
  },
  {
    cause: "$400 minimum QBI deduction held to 20% of taxable income (cautious)",
    kind: "expected",
    applies: (h, o, line, pe) => o.federal.lines.qbiDeduction < 400 && Math.abs(pe.qualified_business_income_deduction - 400) < 0.5,
  },
  {
    cause: "Michigan adds back the self-employment tax deduction (MI Schedule 1 line 2)",
    kind: "bug",
    applies: (h, o, line) => line === "stateTax" && h.stateCode === "MI" && h.tips === 0 && !h.w2Tips && h.profit > 0,
  },
  {
    cause: "State tips breaks (GA, MI) left out (cautious)",
    kind: "expected",
    applies: (h, o, line) => line === "stateTax" && ["GA", "MI"].includes(h.stateCode) && (h.tips > 0 || (h.w2Tips ?? 0) > 0),
  },
  {
    cause: "North Carolina child deduction not modeled (ours higher)",
    kind: "expected",
    applies: (h, o, line, pe, diff) => line === "stateTax" && h.stateCode === "NC" && h.children > 0 && diff > 0,
  },
]

function compare(households, results, table) {
  const byId = new Map(
    results.map((r) => [r.id, { ...r, ctc_limited: Math.round(Math.min(r.ctc, r.income_tax_main_rates) * 100) / 100 }])
  )
  const mismatches = []
  let checked = 0
  for (const h of households) {
    const pe = byId.get(h.id)
    if (!pe) continue
    const o = ours(h, table)
    for (const line of LINES) {
      const mine = line.ours(o)
      if (mine == null) continue
      checked++
      const theirs = pe[line.pe]
      const diff = Math.round((mine - theirs) * 100) / 100
      if (Math.abs(diff) <= TOLERANCE) continue
      const found = CAUSES.find((c) => c.applies(h, o, line.key, pe, diff, table))
      mismatches.push({
        id: h.id,
        label: h.label ?? null,
        line: line.key,
        ours: mine,
        policyengine: theirs,
        diff,
        cause: found?.cause ?? "unexplained",
        kind: found?.kind ?? "unexplained",
        household: h,
      })
    }
  }
  return { checked, mismatches }
}

// Income tax after the child credit, federal plus state: the number an
// expected (cautious) difference may only ever push up.
function totalIncomeTax(o, pe) {
  const ours = o.federal.lines.incomeTaxBeforeCredits - o.federal.lines.childTaxCredit + (o.state?.tax ?? 0)
  const theirs = pe.income_tax_main_rates - Math.min(pe.ctc, pe.income_tax_main_rates) + pe.state_tax_before_credits
  return { ours, theirs }
}

module.exports = { compare, totalIncomeTax, TOLERANCE }

if (require.main === module) {
  const file = process.argv[2] ?? path.join(__dirname, "policyengine-results.json")
  const { results, policyengineUsVersion, year } = JSON.parse(fs.readFileSync(file, "utf8"))
  const { getEstimatedTaxYear } = require("../../shared/estimatedTax/years/index.ts")
  const table = getEstimatedTaxYear(year)
  // The households PolicyEngine actually ran (edge cases depend on our code,
  // so rebuilding them after a change would compare different households).
  const { households } = JSON.parse(fs.readFileSync(path.join(__dirname, "inputs.json"), "utf8"))
  const { checked, mismatches } = compare(households, results, table)
  const kinds = (kind) => mismatches.filter((m) => m.kind === kind).length
  console.log(`PolicyEngine-US ${policyengineUsVersion}: ${results.length} households, ${checked} lines compared (±$${TOLERANCE})`)
  console.log(`${mismatches.length} differ: ${kinds("expected")} expected, ${kinds("bug")} bugs, ${kinds("unexplained")} unexplained\n`)

  const groups = new Map()
  for (const m of mismatches) {
    if (!groups.has(m.cause)) groups.set(m.cause, [])
    groups.get(m.cause).push(m)
  }
  for (const [cause, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    const households = new Set(list.map((m) => m.id)).size
    const lines = [...new Set(list.map((m) => m.line))].join(", ")
    const signed = list.map((m) => m.diff)
    console.log(`[${list[0].kind}] ${cause}`)
    console.log(`   ${households} households; lines: ${lines}; ours − PE from $${Math.min(...signed).toFixed(2)} to $${Math.max(...signed).toFixed(2)}`)
    for (const m of list.filter((m) => m.kind !== "expected").slice(0, 3)) {
      const h = m.household
      console.log(
        `   e.g. ${m.id}${m.label ? ` (${m.label})` : ""}: ${h.filingStatus}, profit ${h.profit}, W-2 ${h.w2Wages}, kids ${h.children}, tips ${h.tips}, ${h.stateCode} — ${m.line}: ours ${m.ours}, PE ${m.policyengine}`
      )
    }
  }
  const out = path.join(__dirname, "mismatches.json")
  fs.writeFileSync(out, JSON.stringify(mismatches, null, 1))
  console.log(`\nall differences: ${path.relative(process.cwd(), out)}`)
}
