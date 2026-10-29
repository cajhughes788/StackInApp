// Tax audit, part 2 (fast check): our tax math against ~500 answers saved
// from PolicyEngine, an independent open-source US tax calculator, for each
// tax year with a saved snapshot (scripts/oracle/README.md). Fails on any
// difference that isn't one of the deliberate, cautious choices listed in
// scripts/oracle/compare.cjs — and if one of those ever makes our estimate
// lower rather than higher.
// Usage: node scripts/test-tax-oracle.cjs
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { ours } = require("./oracle/households.cjs")
const { compare, totalIncomeTax } = require("./oracle/compare.cjs")
const { getEstimatedTaxYear } = require("../shared/estimatedTax/years/index.ts")

let failures = 0
function test(name, fn) {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (err) {
    failures++
    console.log(`FAIL  ${name}`)
    console.log(String(err.message).replace(/^/gm, "      "))
  }
}

const snapshots = fs
  .readdirSync(path.join(__dirname, "oracle"))
  .filter((f) => /^policyengine-\d{4}-snapshot\.json$/.test(f))
  .sort()

for (const file of snapshots) {
  const snapshot = require(path.join(__dirname, "oracle", file))
  const table = getEstimatedTaxYear(snapshot.year)
  const households = snapshot.cases.map((c) => c.household)
  const results = snapshot.cases.map((c) => c.policyengine)
  console.log(`${snapshot.year} — PolicyEngine-US ${snapshot.policyengineUsVersion}`)

  if (!table) {
    test(`${snapshot.year}: the year is turned on`, () => assert.fail(`No ${snapshot.year} table in shared/estimatedTax/years/index.ts`))
    continue
  }
  const { checked, mismatches } = compare(households, results, table)

  test(`every line matches or has a known cause (${snapshot.cases.length} households, ${checked} lines)`, () => {
    const bad = mismatches.filter((m) => m.kind !== "expected")
    const list = bad
      .slice(0, 10)
      .map((m) => `${m.id} ${m.line}: ours ${m.ours}, PolicyEngine ${m.policyengine} — ${m.cause}`)
      .join("\n")
    assert.equal(bad.length, 0, `${bad.length} lines differ for no expected reason:\n${list}`)
  })

  test("expected differences only ever make our income tax higher", () => {
    const byId = new Map(results.map((r) => [r.id, r]))
    const lower = []
    for (const id of new Set(mismatches.map((m) => m.id))) {
      const h = households.find((x) => x.id === id)
      const { ours: mine, theirs } = totalIncomeTax(ours(h, table), byId.get(id))
      if (mine < theirs - 1) lower.push(`${id}: ours ${mine.toFixed(2)}, PolicyEngine ${theirs.toFixed(2)}`)
    }
    assert.equal(lower.length, 0, `our estimate is lower for:\n${lower.slice(0, 10).join("\n")}`)
  })

  test("the snapshot covers every filing status and every included state", () => {
    const statuses = new Set(households.map((h) => h.filingStatus))
    const states = new Set(households.map((h) => h.stateCode))
    assert.equal(statuses.size, 4)
    for (const code of Object.keys(table.states)) assert.ok(states.has(code), `missing ${code}`)
  })
}

console.log(failures ? `\n${failures} test(s) failed` : "\nall tests passed")
process.exit(failures ? 1 : 0)
