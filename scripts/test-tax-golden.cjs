// Tax audit, part 4: what the Taxes page and the reminder push show for
// ~180 real-life situations (scripts/golden/scenarios.cjs), for every tax
// year that's turned on, compared with the saved results in
// scripts/golden/tax-<year>.golden.json. Any change a user would see — a
// cent, a due date, a message — fails with a readable list of what moved.
//
// Usage:
//   node scripts/test-tax-golden.cjs                 compare every year
//   node scripts/test-tax-golden.cjs --update [year] save the current results
//                                                    (only for intended changes)
const fs = require("node:fs")
const path = require("node:path")
const { buildScenarios } = require("./golden/scenarios.cjs")
const { runScenario } = require("./golden/run.cjs")
const { SUPPORTED_ESTIMATED_TAX_YEARS } = require("../shared/estimatedTax/years/index.ts")

const goldenFile = (year) => path.join(__dirname, "golden", `tax-${year}.golden.json`)
const update = process.argv.includes("--update")
const onlyYear = Number(process.argv.find((arg) => /^\d{4}$/.test(arg))) || null

// The backend logs best-effort failures; keep the output to the results.
console.warn = () => {}

function flatten(value, prefix = "", out = {}) {
  if (Array.isArray(value)) {
    out[prefix] = JSON.stringify(value)
  } else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) flatten(inner, prefix ? `${prefix}.${key}` : key, out)
  } else {
    out[prefix] = value
  }
  return out
}

;(async () => {
  let failed = false
  for (const year of SUPPORTED_ESTIMATED_TAX_YEARS.filter((y) => !onlyYear || y === onlyYear)) {
    if (!(await checkYear(year))) failed = true
  }
  process.exit(failed ? 1 : 0)
})()

async function checkYear(year) {
  const scenarios = buildScenarios(year)
  const GOLDEN = goldenFile(year)
  const results = {}
  for (const scenario of scenarios) results[scenario.name] = await runScenario(scenario)

  if (update) {
    fs.writeFileSync(GOLDEN, JSON.stringify(results, null, 1) + "\n")
    console.log(`saved ${scenarios.length} ${year} scenarios to ${path.relative(process.cwd(), GOLDEN)}`)
    return true
  }
  if (!fs.existsSync(GOLDEN)) {
    console.log(`FAIL  no ${year} golden file yet — run with --update ${year} once the results are checked`)
    return false
  }

  const saved = JSON.parse(fs.readFileSync(GOLDEN, "utf8"))
  const changed = []
  for (const [name, result] of Object.entries(results)) {
    if (!(name in saved)) {
      changed.push(`${name}\n      new scenario (not in the golden file)`)
      continue
    }
    const before = flatten(saved[name])
    const after = flatten(result)
    const diffs = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => before[key] !== after[key])
      .map((key) => `${key}: ${before[key]} → ${after[key]}`)
    if (diffs.length) changed.push(`${name}\n      ${diffs.join("\n      ")}`)
  }
  for (const name of Object.keys(saved)) if (!(name in results)) changed.push(`${name}\n      removed from scenarios.cjs`)

  if (changed.length) {
    console.log(`FAIL  ${year}: ${changed.length} of ${scenarios.length} situations changed:\n`)
    console.log(changed.slice(0, 25).map((c) => `  ${c}`).join("\n\n"))
    if (changed.length > 25) console.log(`\n  …and ${changed.length - 25} more`)
    console.log(`\nIf every change is intended, save them with: node scripts/test-tax-golden.cjs --update ${year}`)
    return false
  }
  console.log(`  ok  ${year}: all ${scenarios.length} situations match the golden file`)
  return true
}
