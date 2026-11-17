// Scores voice on Add expense (including "Fix by voice" corrections, the
// cases with `current`) against real-style sentences
// (scripts/voice-expense-cases.json), using the exact parser the server runs
// (backend/functions/src/services/voiceExpenseService.ts) with a made-up set
// of past bank-review decisions in place of Firestore. It calls Claude, so it
// needs a key and costs a few cents a run. Not part of `npm test` for that reason.
//
//   ANTHROPIC_API_KEY=... node scripts/eval-voice-expense.cjs --thinking=off
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
  // The service imports Firestore for the real learned lookup; the eval passes its own.
  if (request === "../admin" && rest[0] && String(rest[0].filename).includes("voiceExpenseService")) {
    return path.join(__dirname, "eval-voice-admin-stub.cjs");
  }
  return originalResolve.call(this, request, ...rest);
};

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY first (the same key the server uses).");
  process.exit(2);
}

const Anthropic = require("@anthropic-ai/sdk").default;
const { parseVoiceExpenseWith } = require("../backend/functions/src/services/voiceExpenseService.ts");
const { normalizePlaidMerchantKey } = require("../shared/plaidClassification.ts");
const sheet = require("./voice-expense-cases.json");

const thinkingArg = process.argv.find((arg) => arg.startsWith("--thinking="));
const thinking = thinkingArg ? thinkingArg.split("=")[1] : "adaptive";
const CONCURRENCY = 4;

// Same matching as the server's Firestore lookup, against the sheet's map.
const lookupLearned = async (vendor) => {
  const key = normalizePlaidMerchantKey(vendor, vendor);
  if (!key) return null;
  const keys = key.startsWith("the ") ? [key, key.slice(4)] : [key, `the ${key}`];
  for (const k of keys) if (sheet.learned[k]) return sheet.learned[k];
  return null;
};

const norm = (value) => (typeof value === "string" ? value.trim().toLowerCase() : value);
const fits = (allowed, value, key) => {
  const list = Array.isArray(allowed) ? allowed : [allowed];
  return list.some((want) =>
    typeof want === "number" && typeof value === "number"
      ? Math.abs(want - value) < 0.001
      : key === "vendor"
        ? norm(want) === norm(value)
        : want === value
  );
};

function compare(expect, got) {
  const problems = [];
  const wantExpense = expect.isExpense ?? true;
  if (got.isExpense !== wantExpense) problems.push(`isExpense ${got.isExpense}, wanted ${wantExpense}`);
  if (!wantExpense) return problems;
  if (got.roundTrip !== (expect.roundTrip ?? false)) problems.push(`roundTrip ${got.roundTrip}, wanted ${expect.roundTrip ?? false}`);
  const keys = ["date", "amount", "amountAsWhole", "vendor", "category", "categorySource", "miles", "parkingAndTolls"];
  for (const key of keys) {
    if ("paid" in expect && (key === "amount" || key === "parkingAndTolls")) continue;
    const want = key in expect ? expect[key] : null;
    if (!fits(want, got[key], key)) problems.push(`${key} ${JSON.stringify(got[key])}, wanted ${JSON.stringify(want)}`);
  }
  if ("paid" in expect) {
    const ok =
      (fits(expect.paid, got.amount) && got.parkingAndTolls === null) ||
      (fits(expect.paid, got.parkingAndTolls) && got.amount === null);
    if (!ok) problems.push(`paid: amount ${got.amount} / parkingAndTolls ${got.parkingAndTolls}, wanted ${expect.paid} in one of them`);
  }
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
        kind: "expense",
        transcript: testCase.say,
        today: sheet.today,
        workspaceId: "eval",
        categories: form.categories,
        vehicleCategory: form.vehicleCategory,
        ...(testCase.current ? { current: testCase.current } : {}), ...(testCase.asking ? { asking: testCase.asking } : {}),
      };
      const started = Date.now();
      try {
        const got = await parseVoiceExpenseWith(client, request, lookupLearned, thinking);
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
    console.log(`MISS  [${testCase.form}${testCase.current ? ", fix" : ""}] "${testCase.say}"`);
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
