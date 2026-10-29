// Saves ~500 of PolicyEngine's answers (every edge case plus a spread of the
// random households) to policyengine-2026-snapshot.json, which the regular
// test (scripts/test-tax-oracle.cjs) checks without Python.
// Usage: node scripts/oracle/snapshot.cjs   (after run_policyengine.py)
const fs = require("node:fs")
const path = require("node:path")

const RANDOM_KEPT = 300
const { households } = JSON.parse(fs.readFileSync(path.join(__dirname, "inputs.json"), "utf8"))
const { results, policyengineUsVersion, year } = JSON.parse(fs.readFileSync(path.join(__dirname, "policyengine-results.json"), "utf8"))
const byId = new Map(results.map((r) => [r.id, r]))

const edges = households.filter((h) => h.id.startsWith("edge-"))
const random = households.filter((h) => h.id.startsWith("r-"))
const step = random.length / RANDOM_KEPT
const kept = [...edges, ...Array.from({ length: RANDOM_KEPT }, (_, i) => random[Math.floor(i * step)])]

const snapshot = {
  year,
  policyengineUsVersion,
  generatedAt: new Date().toISOString().slice(0, 10),
  cases: kept.map((h) => ({ household: h, policyengine: byId.get(h.id) })),
}
const out = path.join(__dirname, `policyengine-${year}-snapshot.json`)
fs.writeFileSync(out, JSON.stringify(snapshot, null, 0) + "\n")
console.log(`saved ${snapshot.cases.length} cases to ${path.relative(process.cwd(), out)}`)
