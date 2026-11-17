// Scores booking by voice (new appointments, moves and "Fix by voice"
// corrections, the cases with `current`) against real-style sentences
// (scripts/voice-booking-cases.json), using the exact parser the server runs
// (backend/functions/src/services/voiceBookingService.ts). It calls Claude,
// so it needs a key and costs a few cents a run. Not part of `npm test`.
//
//   ANTHROPIC_API_KEY=... node scripts/eval-voice-booking.cjs --thinking=off
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
const { parseVoiceBookingWith } = require("../backend/functions/src/services/voiceBookingService.ts");
const sheet = require("./voice-booking-cases.json");

const thinkingArg = process.argv.find((arg) => arg.startsWith("--thinking="));
const thinking = thinkingArg ? thinkingArg.split("=")[1] : "adaptive";
const CONCURRENCY = 4;

const oneOf = (allowed, value) => (Array.isArray(allowed) ? allowed.includes(value) : allowed === value);
const lower = (value) => (typeof value === "string" ? value.trim().toLowerCase() : value);
const digits = (value) => (typeof value === "string" ? value.replace(/\D/g, "") : value);

// "2 pm" said as hour 14 is the same time as hour 2 with pm.
function sameTime(want, got) {
  if (want === null || got === null) return want === got;
  const norm = (time) => (time.hour >= 13 ? { ...time, hour: time.hour - 12, meridiem: "pm" } : time);
  const g = norm(got);
  return g.hour === want.hour && g.minute === want.minute && oneOf(want.meridiem, g.meridiem);
}

function compare(expect, got) {
  const problems = [];
  const wantAction = expect.action ?? "book";
  if (got.action !== wantAction) problems.push(`action ${got.action}, wanted ${wantAction}`);
  if (wantAction === "none") return problems;
  for (const key of ["clientName", "clientEmail", "serviceName", "fromClient"]) {
    const want = expect[key] ?? null;
    if (!(Array.isArray(want) ? want.map(lower) : [lower(want)]).includes(lower(got[key]))) {
      problems.push(`${key} ${JSON.stringify(got[key])}, wanted ${JSON.stringify(want)}`);
    }
  }
  if (digits(got.clientPhone ?? null) !== digits(expect.clientPhone ?? null)) {
    problems.push(`clientPhone ${JSON.stringify(got.clientPhone)}, wanted ${JSON.stringify(expect.clientPhone ?? null)}`);
  }
  for (const key of ["price", "minutes", "date", "confirmNow", "fromDate"]) {
    const want = key in expect ? expect[key] : null;
    if (!oneOf(want, got[key])) problems.push(`${key} ${JSON.stringify(got[key])}, wanted ${JSON.stringify(want)}`);
  }
  for (const key of ["time", "fromTime"]) {
    const want = expect[key] ?? null;
    if (!sameTime(want, got[key])) problems.push(`${key} ${JSON.stringify(got[key])}, wanted ${JSON.stringify(want)}`);
  }
  if (expect.locationHas) {
    if (!got.location || !got.location.toLowerCase().includes(expect.locationHas.toLowerCase())) problems.push(`location ${JSON.stringify(got.location)}, wanted "${expect.locationHas}" in it`);
  } else if (got.location !== null) {
    problems.push(`location ${JSON.stringify(got.location)}, wanted null`);
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
        kind: "booking",
        mode: testCase.mode,
        transcript: testCase.say,
        today: sheet.today,
        clients: sheet.clients,
        services: sheet.services,
        ...(testCase.current ? { current: testCase.current } : {}), ...(testCase.asking ? { asking: testCase.asking } : {}),
      };
      const started = Date.now();
      try {
        const got = await parseVoiceBookingWith(client, request, thinking);
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
    console.log(`MISS  [${testCase.mode}${testCase.current ? ", fix" : ""}] "${testCase.say}"`);
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
