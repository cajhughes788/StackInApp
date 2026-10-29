// Tax audit, part 5: is each tax year ready? (docs/tax-yearly-update.md)
//   - no number is still marked /* UNVERIFIED */ (scripts/new-tax-year.cjs)
//   - from Nov 1, a warning when next year's table is missing (the hard
//     failure on Jan 1 is the tripwire in test-estimated-tax.cjs)
//   - every year that's turned on has due dates on weekdays, a saved
//     PolicyEngine check and a golden file
// Usage: node scripts/test-tax-year-readiness.cjs [YYYY-MM-DD as today]
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
})

const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { getEstimatedTaxYear, SUPPORTED_ESTIMATED_TAX_YEARS } = require("../shared/estimatedTax/years/index.ts")

const ROOT = path.join(__dirname, "..")
const today = process.argv[2] ?? new Date().toISOString().slice(0, 10)
const thisYear = Number(today.slice(0, 4))

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
const warn = (message) => console.log(`WARN  ${message}`)

console.log(`tax year readiness (today ${today}; turned on: ${SUPPORTED_ESTIMATED_TAX_YEARS.join(", ")})\n`)

const tableFiles = [
  ...fs.readdirSync(path.join(ROOT, "shared/estimatedTax/years")).map((f) => `shared/estimatedTax/years/${f}`),
  ...fs.readdirSync(path.join(ROOT, "shared/tax/tables")).map((f) => `shared/tax/tables/${f}`),
].filter((f) => f.endsWith(".ts"))

test("no tax number is left unverified", () => {
  const left = tableFiles
    .map((file) => [file, (fs.readFileSync(path.join(ROOT, file), "utf8").match(/\/\* UNVERIFIED \*\//g) ?? []).length])
    .filter(([, count]) => count > 0)
  assert.equal(
    left.length,
    0,
    left.map(([file, count]) => `${file}: ${count} numbers still marked UNVERIFIED`).join("\n") +
      "\nCheck each against its source and remove the mark (docs/tax-yearly-update.md)."
  )
})

// From November 1 there's about ten weeks to add next year before the app
// switches over on January 16.
const nextYear = thisYear + 1
if (today.slice(5) >= "11-01" && !getEstimatedTaxYear(nextYear)) {
  const drafted = fs.existsSync(path.join(ROOT, `shared/estimatedTax/years/${nextYear}.ts`))
  warn(
    `${nextYear} tax table isn't turned on yet — the app needs it by Jan 16, ${nextYear}. ` +
      (drafted
        ? `A draft exists (shared/estimatedTax/years/${nextYear}.ts); finish checking it.`
        : `Start it with: node scripts/new-tax-year.cjs ${nextYear}`) +
      " See docs/tax-yearly-update.md."
  )
}

for (const year of SUPPORTED_ESTIMATED_TAX_YEARS) {
  const table = getEstimatedTaxYear(year)

  test(`${year}: due dates fall on weekdays`, () => {
    const weekend = table.quarters.filter((q) => {
      const [y, m, d] = q.dueDate.split("-").map(Number)
      const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
      return day === 0 || day === 6
    })
    assert.equal(
      weekend.length,
      0,
      weekend.map((q) => `Q${q.quarter} ${q.dueDate} is a weekend — the IRS moves it to the next business day (check Form 1040-ES)`).join("\n")
    )
  })

  test(`${year}: checked against PolicyEngine (scripts/oracle/policyengine-${year}-snapshot.json)`, () => {
    assert.ok(
      fs.existsSync(path.join(ROOT, `scripts/oracle/policyengine-${year}-snapshot.json`)),
      `Run the outside check for ${year} (docs/tax-yearly-update.md, step 5).`
    )
  })

  test(`${year}: golden file saved (scripts/golden/tax-${year}.golden.json)`, () => {
    assert.ok(
      fs.existsSync(path.join(ROOT, `scripts/golden/tax-${year}.golden.json`)),
      `Save it with: node scripts/test-tax-golden.cjs --update ${year}`
    )
  })
}

console.log(failures ? `\n${failures} test(s) failed` : "\nall tests passed")
process.exit(failures ? 1 : 0)
