// Scores Ask 521 (Home's mic: questions, opening pages, things to log)
// against real-style sentences (scripts/voice-ask-cases.json), using the exact
// parser the server runs (backend/functions/src/services/voiceAskService.ts).
// It calls Claude, so it needs a key and costs a few cents a run. Not part of `npm test`.
//
//   ANTHROPIC_API_KEY=... node scripts/eval-voice-ask.cjs --thinking=off

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
const { parseVoiceAskWith } = require("../backend/functions/src/services/voiceAskService.ts");
const sheet = require("./voice-ask-cases.json");

const thinkingArg = process.argv.find((arg) => arg.startsWith("--thinking="));
const thinking = thinkingArg ? thinkingArg.split("=")[1] : "adaptive";
const CONCURRENCY = 4;

const list = (value) => (Array.isArray(value) ? value : [value]);
const lower = (value) => (typeof value === "string" ? value.trim().toLowerCase() : value);

function periodFits(want, got) {
  if (want === null) return got === null;
  if (!got || got.kind !== want.kind) return false;
  return ["month", "quarter", "year", "date"].every((key) => !(key in want) || list(want[key]).includes(got[key]));
}

function compare(expect, got) {
  const problems = [];
  if (!list(expect.intent).includes(got.intent)) problems.push(`intent ${got.intent}, wanted ${JSON.stringify(expect.intent)}`);
  // unsupported: true = must name something it can't split by; left out = must be null.
  if (expect.unsupported === true ? !got.unsupported : got.unsupported) problems.push(`unsupported ${JSON.stringify(got.unsupported)}, wanted ${expect.unsupported ? "something" : "null"}`);
  if ("hasDetails" in expect && got.hasDetails !== expect.hasDetails) problems.push(`hasDetails ${got.hasDetails}, wanted ${expect.hasDetails}`);
  for (const key of ["topic", "page", "form", "category", "client", "paymentMethod"]) {
    const want = key in expect ? expect[key] : null;
    if (!list(want).map(lower).includes(lower(got[key]))) problems.push(`${key} ${JSON.stringify(got[key])}, wanted ${JSON.stringify(want)}`);
  }
  for (const key of ["period", "comparePeriod"]) {
    if (!(key in expect)) continue;
    if (!list(expect[key]).some((want) => periodFits(want, got[key]))) problems.push(`${key} ${JSON.stringify(got[key])}, wanted ${JSON.stringify(expect[key])}`);
  }
  return problems;
}

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 30_000 });
  const queue = sheet.cases.map((testCase, index) => ({ ...testCase, index }));
  const results = [];
  const worker = async () => {
    for (let testCase = queue.shift(); testCase; testCase = queue.shift()) {
      const request = {
        kind: "ask",
        transcript: testCase.say,
        today: sheet.today,
        workspaceType: testCase.ws,
        clients: testCase.ws === "independent" ? sheet.clients : [],
        expenseCategories: testCase.ws === "independent" ? sheet.expenseCategories : [],
      };
      const started = Date.now();
      try {
        const got = await parseVoiceAskWith(client, request, thinking);
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
    console.log(`MISS  [${testCase.ws}] "${testCase.say}"`);
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
