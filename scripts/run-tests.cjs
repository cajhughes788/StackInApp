// Runs every scripts/test-*.cjs, so a new test is included automatically and
// a stale one can't go unnoticed. Usage: node scripts/run-tests.cjs
// (call node directly — `npm run -s` fails silently in some shells).
const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

const dir = __dirname
const tests = fs
  .readdirSync(dir)
  .filter((name) => /^test-.*\.cjs$/.test(name))
  .sort()

const failed = []
for (const name of tests) {
  const result = spawnSync(process.execPath, [path.join(dir, name)], { encoding: "utf8" })
  const label = name.replace(/^test-|\.cjs$/g, "")
  if (result.status === 0) {
    console.log(`ok    ${label}`)
  } else {
    failed.push(label)
    console.log(`FAIL  ${label}`)
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").slice(-15).join("\n")
    if (output) console.log(output.replace(/^/gm, "      "))
  }
}

console.log(`\n${tests.length - failed.length}/${tests.length} test files passed`)
process.exit(failed.length > 0 ? 1 : 0)
