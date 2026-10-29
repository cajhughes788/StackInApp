// Starts a new tax year for the self-employed estimate (docs/tax-yearly-update.md).
// Copies last year's estimate table and federal brackets to the new year
// with EVERY number marked /* UNVERIFIED */ — scripts/test-tax-year-readiness.cjs
// fails until each mark is checked against its source and removed. The new
// year is not turned on (years/index.ts) until that's done.
//
// Usage: node scripts/new-tax-year.cjs 2027
const fs = require("node:fs")
const path = require("node:path")

const year = Number(process.argv[2])
if (!Number.isInteger(year) || year < 2027 || year > 2100) {
  console.error("Usage: node scripts/new-tax-year.cjs <year>   (for example 2027)")
  process.exit(1)
}
const prior = year - 1
const root = path.join(__dirname, "..", "shared")
const files = {
  priorYear: path.join(root, "estimatedTax", "years", `${prior}.ts`),
  newYear: path.join(root, "estimatedTax", "years", `${year}.ts`),
  priorFederal: path.join(root, "tax", "tables", `federal${prior}.ts`),
  newFederal: path.join(root, "tax", "tables", `federal${year}.ts`),
  states: path.join(root, "estimatedTax", "states.ts"),
}
for (const key of ["priorYear", "priorFederal"]) {
  if (!fs.existsSync(files[key])) {
    console.error(`Missing ${path.relative(process.cwd(), files[key])} — start from the latest year that exists.`)
    process.exit(1)
  }
}
for (const key of ["newYear", "newFederal"]) {
  if (fs.existsSync(files[key])) {
    console.error(`${path.relative(process.cwd(), files[key])} already exists; not overwriting.`)
    process.exit(1)
  }
}

const MARK = "/* UNVERIFIED */"

// Marks every number that is a property value, and moves YYYY-MM-DD dates
// forward a year, marking them too. Comment lines are left alone.
function markNumbers(text) {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim()
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return line
      return line
        .replace(/"(\d{4})-(\d{2})-(\d{2})"/g, (_, y, m, d) => `"${Number(y) + 1}-${m}-${d}" ${MARK}`)
        // A no-tax state still needs checking: did it add an income tax?
        .replace(/(kind: "none")/g, `$1 ${MARK}`)
        .replace(/(\b\w+)(:\s*)(-?\d[\d_]*(?:\.\d+)?)(?=\s*(?:,|}|\]|$))/g, (match, key, colon, value) =>
          // A quarter's number and the year itself aren't figures to look up.
          key === "quarter" || key === "year" ? match : `${key}${colon}${value} ${MARK}`
        )
    })
    .join("\n")
}

const header = (what) => `// ============================================================
// UNVERIFIED COPY of ${prior}'s ${what} for ${year}, made by
// scripts/new-tax-year.cjs. Every number below is still ${prior}'s until it
// is checked against its ${year} source (docs/tax-yearly-update.md); then
// remove its ${MARK} mark and update the source comment above it.
// The tests fail while any mark is left.
// ============================================================
`

// ---- Federal brackets and standard deductions ----
let federal = fs.readFileSync(files.priorFederal, "utf8")
federal = federal
  .replaceAll(`FEDERAL_${prior}`, `FEDERAL_${year}`)
  .replaceAll(`federal${prior}`, `federal${year}`)
  .replace(`${prior} IRS federal income tax schedules`, `${year} IRS federal income tax schedules`)
  .replace(`/tables/federal${prior}.ts`, `/tables/federal${year}.ts`)
fs.writeFileSync(files.newFederal, header("federal brackets") + markNumbers(federal))

// ---- State rules: copied out of states.ts into the year's own table ----
const statesSource = fs.readFileSync(files.states, "utf8")
const start = statesSource.indexOf(`export const STATE_TAX_${prior}`)
if (start < 0) {
  console.error(`No STATE_TAX_${prior} in states.ts — copy the state rules by hand.`)
  process.exit(1)
}
const end = statesSource.indexOf("\n}\n", start) + 3
const noWageTax = statesSource.match(/const NO_WAGE_TAX = "([^"]*)"/)?.[1] ?? "No state tax on wages or business income."
const stateBlock = statesSource
  .slice(start, end)
  .replace(`export const STATE_TAX_${prior}`, `const STATE_TAX_${year}`)
  .replaceAll("`${NO_WAGE_TAX}", "`" + noWageTax)
  .replaceAll("NO_WAGE_TAX", JSON.stringify(noWageTax))

// ---- The estimate table ----
let table = fs.readFileSync(files.priorYear, "utf8")
table = table
  .replaceAll(`ESTIMATED_TAX_${prior}`, `ESTIMATED_TAX_${year}`)
  .replaceAll(`FEDERAL_${prior}`, `FEDERAL_${year}`)
  .replaceAll(`federal${prior}`, `federal${year}`)
  .replace(`import { STATE_TAX_${prior} } from "../states"`, `import type { StateTaxRule } from "../states"`)
  .replaceAll(`STATE_TAX_${prior}`, `STATE_TAX_${year}`)
  .replace(`year: ${prior},`, `year: ${year},`)
  .replace(`/years/${prior}.ts`, `/years/${year}.ts`)
const exportAt = table.indexOf(`export const ESTIMATED_TAX_${year}`)
table = table.slice(0, exportAt) + `// State rules for ${year} (copied from ${prior}; see states.ts for the rule shapes).\n` + stateBlock + "\n" + table.slice(exportAt)
fs.writeFileSync(files.newYear, header("estimated tax table") + markNumbers(table))

const marks = (file) => (fs.readFileSync(file, "utf8").match(/\/\* UNVERIFIED \*\//g) ?? []).length
console.log(`Created (not turned on yet):
  ${path.relative(process.cwd(), files.newYear)}  — ${marks(files.newYear)} numbers to check
  ${path.relative(process.cwd(), files.newFederal)}  — ${marks(files.newFederal)} numbers to check

Next (docs/tax-yearly-update.md):
  1. Check each number against its ${year} source; remove its ${MARK} mark.
  2. Add the "${year} figures match their published sources" test.
  3. Add ${year} to YEARS in shared/estimatedTax/years/index.ts.
  4. Rerun the PolicyEngine check and save the ${year} golden file.`)
