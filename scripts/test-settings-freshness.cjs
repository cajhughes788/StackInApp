// Settings must never be served from an in-memory copy on the server.
//
// Every Cloud Function runs on its own instances, so a module-level cache in
// one function can't see a save made by saveSettings. That served stale
// settings for up to 5 minutes after a change (Oct 2026: a source switched on
// looked off again after reload; expenses could use settings from whenever
// their instance started). Settings reads go to Firestore every time.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const SRC = path.join(__dirname, "..", "backend", "functions", "src");

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (/\.ts$/.test(name)) out.push(full);
  }
  return out;
}

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(error.message);
  }
}

console.log("settings freshness");

const files = walk(SRC);

test("the old settingsCache module is gone", () => {
  assert.equal(fs.existsSync(path.join(SRC, "services", "settingsCache.ts")), false);
});

test("no backend file keeps settings in a module-level cache", () => {
  const offenders = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    // A module-level object/Map keyed by workspace that holds settings.
    if (/settingsCache|^(?:export\s+)?const\s+\w*[Ss]ettings\w*\s*(?::[^=]+)?=\s*(?:\{\s*\}|new Map)/m.test(text)) {
      offenders.push(path.relative(SRC, file));
    }
  }
  assert.deepEqual(offenders, [], `settings cached in memory in: ${offenders.join(", ")}`);
});

test("startup reads the settings document every time", () => {
  const text = fs.readFileSync(path.join(SRC, "routes", "getAppBootstrap.ts"), "utf8");
  assert.match(text, /db\.doc\(`workspaces\/\$\{workspaceId\}\/settings\/current`\)\.get\(\)/);
  assert.doesNotMatch(text, /Promise\.resolve\(null\)/);
});

if (failures > 0) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall passed");
