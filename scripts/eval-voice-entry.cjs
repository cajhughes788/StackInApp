// Scores voice entry against real-style sentences (scripts/voice-entry-cases.json),
// using the exact parser the server runs (backend/functions/src/services/voiceEntryService.ts).
// It calls Claude, so it needs a key and costs a few cents a run. Not part of
// `npm test` for that reason.
//
// Run it before shipping, and again whenever the instructions in
// voiceEntryService.ts change or a new Claude model comes out:
//
//   ANTHROPIC_API_KEY=... node scripts/eval-voice-entry.cjs
//   ANTHROPIC_API_KEY=... node scripts/eval-voice-entry.cjs --thinking=off   (faster? compare the pass rate)
//
// Prints each miss, the pass rate, and how long replies took.

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", esModuleInterop: true },
});

const path = require("node:path");
const Module = require("node:module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@shared/")) {
    request = path.join(__dirname, "..", "shared", request.slice("@shared/".length));
  }
  return originalResolve.call(this, request, ...rest);
};

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY first (the same key the server uses).");
  process.exit(2);
}

const Anthropic = require("@anthropic-ai/sdk").default;
const { parseVoiceEntryWith } = require("../backend/functions/src/services/voiceEntryService.ts");
const sheet = require("./voice-entry-cases.json");

const thinkingArg = process.argv.find((arg) => arg.startsWith("--thinking="));
const thinking = thinkingArg ? thinkingArg.split("=")[1] : "adaptive";
const CONCURRENCY = 4;

const oneOf = (allowed, value) => (Array.isArray(allowed) ? allowed.includes(value) : allowed === value);

function compare(expect, got) {
  const problems = [];
  const wantEntry = expect.isEntry ?? true;
  if (got.isEntry !== wantEntry) problems.push(`isEntry ${got.isEntry}, wanted ${wantEntry}`);
  for (const key of ["date", "hours", "inTime", "outTime", "positionId"]) {
    const want = expect[key] ?? null;
    if (got[key] !== want) problems.push(`${key} ${JSON.stringify(got[key])}, wanted ${JSON.stringify(want)}`);
  }
  // Every expected amount matched once; nothing extra.
  const remaining = [...got.amounts];
  for (const want of expect.amounts ?? []) {
    const index = remaining.findIndex(
      (item) =>
        oneOf(want.target, item.target) &&
        Math.abs(item.amount - want.amount) < 0.001 &&
        (!("category" in want) || oneOf(want.category, item.category))
    );
    if (index === -1) problems.push(`missing amount ${JSON.stringify(want)}`);
    else remaining.splice(index, 1);
  }
  for (const extra of remaining) problems.push(`extra amount ${JSON.stringify(extra)}`);
  return problems;
}

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 30_000 });
  const queue = sheet.cases.map((testCase, index) => ({ ...testCase, index }));
  const results = [];

  const worker = async () => {
    for (let testCase = queue.shift(); testCase; testCase = queue.shift()) {
      const form = sheet.forms[testCase.form];
      const request = {
        transcript: testCase.say,
        today: sheet.today,
        workspaceType: form.workspaceType,
        fields: form.fields,
        positions: form.positions ?? [],
      };
      const started = Date.now();
      try {
        const got = await parseVoiceEntryWith(client, request, thinking);
        results.push({ testCase, ms: Date.now() - started, problems: compare(testCase.expect, got), got });
      } catch (error) {
        results.push({ testCase, ms: Date.now() - started, problems: [`failed: ${error.message}`], got: null });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  results.sort((a, b) => a.testCase.index - b.testCase.index);

  let passed = 0;
  for (const { testCase, problems, got } of results) {
    if (problems.length === 0) {
      passed += 1;
      continue;
    }
    console.log(`MISS${testCase.hard ? " (hard)" : ""}  [${testCase.form}] "${testCase.say}"`);
    for (const problem of problems) console.log(`      ${problem}`);
    if (got) console.log(`      got ${JSON.stringify(got)}`);
  }

  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const pick = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
  console.log(
    `\nthinking=${thinking}: ${passed}/${results.length} passed (${Math.round((passed / results.length) * 100)}%)` +
      ` · reply time median ${pick(0.5)}ms, slowest 10% ${pick(0.9)}ms`
  );
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
